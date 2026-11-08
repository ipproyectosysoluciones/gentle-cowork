/**
 * WS Protocol for Phase 5 Stage 3 — Master/Worker coordination.
 * Reuses framing pattern from dot-telegram daemon protocol.
 */
export const WS_PROTOCOL_VERSION = 1;
export const WS_PORT = 4318;
export const WS_BIND = "127.0.0.1";

/** Close codes (following dot-telegram pattern) */
export const CloseCode = {
	unauthorized: 4401,
	badProtocol: 4400,
	leaseRejected: 4402,
	workerExists: 4403,
	rateLimited: 4405,
	messageTooLarge: 4406,
} as const;

// Security limits
export const MAX_MESSAGE_SIZE = 64 * 1024; // 64KB
export const MAX_JSON_DEPTH = 32;
export const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
export const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute per IP

// TLS configuration
export interface TLSConfig {
	cert: string;  // PEM-encoded certificate
	key: string;   // PEM-encoded private key
	ca?: string;   // PEM-encoded CA for client cert verification (mTLS)
	requestCert?: boolean;
	rejectUnauthorized?: boolean;
}

/** Validates and returns WS_BIND (H2). */
export function validateWSBind(bind: string | undefined): string {
	const b = (bind ?? "127.0.0.1").trim();
	if (!/^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/i.test(b)) {
		throw new Error(`Invalid WS_BIND: ${b} (must be IPv4 or IPv6 address)`);
	}
	return b;
}

/** Validates and returns WS_PORT (H2). */
export function validateWSPort(port: string | undefined): number {
	const p = parseInt((port ?? "4318").trim(), 10);
	if (!Number.isInteger(p) || p < 1 || p > 65535) {
		throw new Error(`Invalid WS_PORT: ${port} (must be 1-65535)`);
	}
	return p;
}

/** Generates a cryptographically secure fence token (H3). */
export function generateFence(): number {
	const { randomBytes } = require("node:crypto");
	const bytes = randomBytes(8); // 64 bits
	let fence = 0;
	for (let i = 0; i < 8; i++) {
		fence = (fence << 8) | bytes[i];
	}
	// Ensure it's positive and reasonable
	return Math.abs(fence) % Number.MAX_SAFE_INTEGER;
}

/** Generates a cryptographically secure nonce (H5). */
export function generateNonce(): string {
	const { randomBytes } = require("node:crypto");
	return randomBytes(16).toString("base64");
}

/** Validates message timestamp freshness (H5). */
export function isTimestampFresh(timestamp: number, maxAgeMs = 60_000): boolean {
	const now = Date.now();
	const age = now - timestamp;
	return age >= 0 && age <= maxAgeMs;
}

/** Worker capabilities */
export type Capability = "planner" | "implementer" | "verifier";

/** Worker registration */
export interface RegisterWorker {
	type: "register_worker";
	nodeId: string;
	role: "master" | "worker";
	capabilities: Capability[];
	startedAt: string;
}

/** Master assigns step to worker */
export interface AssignStep {
	type: "assign_step";
	contractId: string;
	step: {
		id: string;
		objective: string;
		scope: string[];
		acceptanceCriteria: string[];
		/** ODD spec the step implements (T5.9) — passed through to the worker prompt. */
		specRef?: string;
	};
	workerNodeId: string;
}

/**
 * Structured verdict a remote worker returns with its step result (T5.9).
 * Structurally identical to `orchestrator/types.ts` `WorkerStepVerdict` — kept
 * local so the transport never depends on the orchestrator module graph.
 */
export interface WorkerVerdictPayload {
	contractId: string;
	workerNodeId: string;
	status: "completed" | "failed";
	criteria: Array<{ criterion: string; satisfied: boolean; evidence: string }>;
	artifacts: string[];
	executedAt: string;
	error?: string;
}

/** Worker reports step result */
export interface StepResult {
	type: "step_result";
	contractId: string;
	stepId: string;
	artifact: string;
	status: "completed" | "failed";
	verdict?: {
		decision: "CHANGES" | "NO_CHANGES" | "BLOCKED";
		reason: string;
	};
	/** Full structured verdict for the master to apply to the blackboard (T5.9). */
	workerVerdict?: WorkerVerdictPayload;
}

/** Heartbeat */
export interface Heartbeat {
	type: "heartbeat";
	nodeId: string;
	timestamp: string;
}

/** Lease management */
export interface LeaseRequest {
	type: "lease_request";
	nodeId: string;
	ttlMs: number;
}

export interface LeaseGrant {
	type: "lease_grant";
	granted: boolean;
	expiresAt?: string;
	fence?: number;
	reason?: string;
}

export interface WelcomeMessage {
	type: "welcome";
	protocol: number;
	serverNodeId: string;
}

export interface ErrorMessage {
	type: "error";
	code: string;
	message: string;
}

export interface LeaseGrantMessage {
	type: "lease_grant";
	granted: boolean;
	expiresAt?: string;
	fence?: number;
	reason?: string;
}

export interface LeaseRelease {
	type: "lease_release";
	nodeId: string;
}

/** All message types */
export type ClientMessage =
	| RegisterWorker
	| StepResult
	| Heartbeat
	| LeaseRequest
	| LeaseRelease;

// Message envelope with replay protection (H5)
export interface SignedMessage<T extends ClientMessage> {
	message: T;
	nonce: string;        // Cryptographic nonce (base64, 16 bytes)
	timestamp: number;    // Unix ms when message was created
	signature?: string;   // Optional Ed25519 signature for future mTLS
}

export type ServerMessage =
	| AssignStep
	| LeaseGrant
	| { type: "error"; code: string; message: string }
	| { type: "welcome"; protocol: number; serverNodeId: string };

/** Union for framing */
export type WSMessage = ClientMessage | ServerMessage;

/** Validates a message shape */
export function isValidClientMessage(msg: unknown): msg is ClientMessage {
	if (typeof msg !== "object" || msg === null) return false;
	const m = msg as Record<string, unknown>;
	return typeof m.type === "string" && [
		"register_worker",
		"step_result",
		"heartbeat",
		"lease_request",
		"lease_release",
	].includes(m.type);
}

export function isValidServerMessage(msg: unknown): msg is ServerMessage {
	if (typeof msg !== "object" || msg === null) return false;
	const m = msg as Record<string, unknown>;
	return typeof m.type === "string" && [
		"assign_step",
		"lease_grant",
		"error",
		"welcome",
	].includes(m.type);
}