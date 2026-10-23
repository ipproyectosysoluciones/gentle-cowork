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
} as const;

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