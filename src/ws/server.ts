/**
 * T5.6 WS Transport Skeleton — Master WebSocket Server
 *
 * Port: 4318 (configurable via WS_PORT env)
 * Binding: 127.0.0.1 (WS_BIND env)
 * Protocol: JSON over WebSocket, newline-delimited
 * Reuses framing pattern from dot-telegram daemon protocol.
 */

import { createServer, type Server } from "http";
import WebSocket, { WebSocketServer } from "ws";
import {
	WS_PORT,
	WS_BIND,
	WS_PROTOCOL_VERSION,
	CloseCode,
	type RegisterWorker,
	type AssignStep,
	type StepResult,
	type Heartbeat,
	type LeaseRequest,
	type LeaseGrant,
	type LeaseRelease,
	type ClientMessage,
	type ServerMessage,
	type Capability,
} from "./protocol.ts";

export interface WorkerRegistration {
	nodeId: string;
	role: "master" | "worker";
	capabilities: Capability[];
	startedAt: string;
	ws: WebSocket;
	registeredAt: number;
	lastHeartbeat: number;
}

export interface LeaseState {
	holderNodeId: string | null;
	fence: number;
	expiresAt: number;
}

interface PendingLeaseRequest {
	nodeId: string;
	ttlMs: number;
	resolve: (grant: LeaseGrant) => void;
	reject: (reason: Error) => void;
	timestamp: number;
}

/** Registration summary delivered to the onWorkerRegistered callback (no socket). */
export type WorkerRegistrationSummary = Pick<WorkerRegistration, "nodeId" | "role" | "capabilities" | "startedAt">;

/**
 * Injectable transport callbacks (T5.9). The server never touches the
 * blackboard — the master-side bridge mirrors these events onto it.
 */
export interface WSServerOptions {
	onWorkerRegistered?: (reg: WorkerRegistrationSummary) => void;
	onStepResult?: (msg: StepResult, senderNodeId: string) => void;
	onHeartbeat?: (nodeId: string) => void;
}

export class WSServer {
	httpServer: Server;
	private wss: WebSocketServer;
	private workers = new Map<string, WorkerRegistration>();
	private lease: LeaseState = { holderNodeId: null, fence: 0, expiresAt: 0 };
	private pendingLeases: PendingLeaseRequest[] = [];
	private masterNodeId: string = `master-${process.pid}-${Date.now()}`;
	private leaseProcessing = false;

	constructor(
		private readonly port: number = WS_PORT,
		private readonly bind: string = WS_BIND,
		private readonly options: WSServerOptions = {},
	) {
		this.httpServer = createServer();
		this.wss = new WebSocketServer({ server: this.httpServer });
		this.setupWSS();
	}

	private setupWSS(): void {
		this.wss.on("connection", (ws, req) => {
			const remoteAddr = req.socket.remoteAddress ?? "unknown";
			this.log(`Connection from ${remoteAddr}`);

			let authenticated = false;
			let nodeId: string | null = null;

			const cleanup = () => {
				if (nodeId) {
					this.workers.delete(nodeId);
					this.log(`Worker unregistered: ${nodeId}`);
				}
				// Remove from pending leases
				this.pendingLeases = this.pendingLeases.filter((p) => p.nodeId !== nodeId);
			};

			ws.on("close", (code) => {
				this.log(`Connection closed: ${nodeId ?? "unauthenticated"} (code ${code})`);
				cleanup();
			});

			ws.on("error", (err) => {
				this.log(`WS error: ${err.message}`);
			});

			ws.on("message", async (data) => {
				try {
					const raw = data.toString();
					let msg: unknown;
					try {
						msg = JSON.parse(raw);
					} catch {
						this.sendError(ws, "invalid_json", "Invalid JSON message");
						return;
					}

					if (!this.isValidClientMessage(msg)) {
						this.sendError(ws, "invalid_message", "Invalid message format");
						return;
					}

					const clientMsg = msg as ClientMessage;

					switch (clientMsg.type) {
						case "register_worker": {
							await this.handleRegisterWorker(ws, clientMsg);
							if (ws.readyState === WebSocket.OPEN) {
								authenticated = true;
								nodeId = clientMsg.nodeId;
							}
							break;
						}

						case "step_result": {
							if (!authenticated) {
								this.sendError(ws, "unauthorized", "Not registered");
								return;
							}
							this.handleStepResult(clientMsg, nodeId ?? "unknown");
							break;
						}

						case "heartbeat": {
							if (!authenticated || nodeId !== clientMsg.nodeId) {
								this.sendError(ws, "unauthorized", "Invalid heartbeat");
								return;
							}
							this.handleHeartbeat(clientMsg);
							break;
						}

						case "lease_request": {
							if (!authenticated) {
								this.sendError(ws, "unauthorized", "Not registered");
								return;
							}
							await this.handleLeaseRequest(ws, clientMsg);
							break;
						}

						case "lease_release": {
							if (!authenticated || nodeId !== clientMsg.nodeId) {
								this.sendError(ws, "unauthorized", "Invalid lease release");
								return;
							}
							this.handleLeaseRelease(clientMsg);
							break;
						}

						default:
							this.sendError(ws, "unknown_type", `Unknown message type: ${(clientMsg as ClientMessage).type}`);
					}
				} catch (err) {
					this.log(`Error handling message: ${err instanceof Error ? err.message : String(err)}`);
					this.sendError(ws, "internal_error", "Internal server error");
				}
			});
		});
	}

	private isValidClientMessage(msg: unknown): msg is ClientMessage {
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

	private send(ws: WebSocket, msg: ServerMessage): void {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(msg));
		}
	}

	private sendError(ws: WebSocket, code: string, message: string): void {
		this.send(ws, { type: "error", code, message });
	}

	private log(msg: string): void {
		console.error(`[WS:${new Date().toISOString()}] ${msg}`);
	}

	private async handleRegisterWorker(ws: WebSocket, msg: RegisterWorker): Promise<void> {
		// Validate message
		if (!msg.nodeId || !msg.role || !msg.capabilities || !Array.isArray(msg.capabilities) || !msg.startedAt) {
			this.sendError(ws, "invalid_registration", "Missing required fields");
			ws.close(CloseCode.badProtocol);
			return;
		}

		if (msg.role !== "worker") {
			this.sendError(ws, "invalid_role", "Only worker role allowed for registration");
			ws.close(CloseCode.badProtocol);
			return;
		}

		// Check for duplicate
		const existing = this.workers.get(msg.nodeId);
		if (existing) {
			this.sendError(ws, "worker_exists", `Worker ${msg.nodeId} already registered`);
			ws.close(CloseCode.workerExists);
			return;
		}

		// Register worker
		this.workers.set(msg.nodeId, {
			nodeId: msg.nodeId,
			role: msg.role,
			capabilities: msg.capabilities,
			startedAt: msg.startedAt,
			ws,
			registeredAt: Date.now(),
			lastHeartbeat: Date.now(),
		});

		this.log(`Worker registered: ${msg.nodeId} (${msg.capabilities.join(",")})`);
		this.options.onWorkerRegistered?.({
			nodeId: msg.nodeId,
			role: msg.role,
			capabilities: msg.capabilities,
			startedAt: msg.startedAt,
		});

		// Send welcome
		this.send(ws, {
			type: "welcome",
			protocol: WS_PROTOCOL_VERSION,
			serverNodeId: this.masterNodeId,
		});
	}

	private handleStepResult(msg: StepResult, senderNodeId: string): void {
		this.log(`Step result: ${msg.contractId} ${msg.status} by ${senderNodeId}`);
		this.options.onStepResult?.(msg, senderNodeId);
	}

	private handleHeartbeat(msg: Heartbeat): void {
		const worker = this.workers.get(msg.nodeId);
		if (worker) {
			worker.lastHeartbeat = Date.now();
		}
		this.options.onHeartbeat?.(msg.nodeId);
	}

	private async handleLeaseRequest(ws: WebSocket, msg: LeaseRequest): Promise<void> {
		const worker = this.workers.get(msg.nodeId);
		if (!worker) {
			this.sendError(ws, "unauthorized", "Worker not registered");
			return;
		}

		// Queue lease request for serialized processing
		return new Promise<void>((resolve, reject) => {
			this.pendingLeases.push({
				nodeId: msg.nodeId,
				ttlMs: msg.ttlMs,
				resolve: (grant) => {
					this.send(ws, grant);
					resolve();
				},
				reject,
				timestamp: Date.now(),
			});
			this.processLeaseQueue();
		});
	}

	private async processLeaseQueue(): Promise<void> {
		if (this.leaseProcessing || this.pendingLeases.length === 0) return;

		this.leaseProcessing = true;

		while (this.pendingLeases.length > 0) {
			const request = this.pendingLeases.shift()!;
			const now = Date.now();

			// Check if current lease is expired or no holder
			if (this.lease.holderNodeId === null || this.lease.expiresAt <= now) {
				// Grant lease
				this.lease.fence += 1;
				this.lease.holderNodeId = request.nodeId;
				this.lease.expiresAt = now + request.ttlMs;

				const grant: LeaseGrant = {
					type: "lease_grant",
					granted: true,
					expiresAt: new Date(this.lease.expiresAt).toISOString(),
					fence: this.lease.fence,
				};
				request.resolve(grant);
				this.log(`Lease granted to ${request.nodeId} (fence=${this.lease.fence})`);
			} else {
				// Current lease active - reject
				const grant: LeaseGrant = {
					type: "lease_grant",
					granted: false,
					reason: "lease_active",
					fence: this.lease.fence,
				};
				request.resolve(grant);
				this.log(`Lease rejected for ${request.nodeId}: active holder ${this.lease.holderNodeId} (fence=${this.lease.fence})`);
			}
		}

		this.leaseProcessing = false;
	}

	private handleLeaseRelease(msg: LeaseRelease): void {
		if (this.lease.holderNodeId === msg.nodeId) {
			this.log(`Lease released by ${msg.nodeId} (fence=${this.lease.fence})`);
			this.lease.holderNodeId = null;
			this.lease.expiresAt = 0;
			// Process any pending requests
			this.processLeaseQueue();
		}
	}

	async start(): Promise<void> {
		return new Promise((resolve) => {
			this.httpServer.listen(this.port, this.bind, () => {
				this.log(`WS Server listening on ${this.bind}:${this.port}`);
				resolve();
			});
		});
	}

	async stop(): Promise<void> {
		this.log("Stopping WS Server...");

		// Close all worker connections
		for (const [nodeId, worker] of this.workers) {
			worker.ws.close(1001, "Server shutting down");
			this.log(`Closed connection for ${nodeId}`);
		}
		this.workers.clear();

		// Close WebSocket server
		await new Promise<void>((resolve) => {
			this.wss.close(() => {
				this.log("WebSocket server closed");
				resolve();
			});
		});

		// Close HTTP server
		await new Promise<void>((resolve, reject) => {
			this.httpServer.close((err) => {
				if (err) reject(err);
				else {
					this.log("HTTP server closed");
					resolve();
				}
			});
		});
	}

	// Test helpers
	getWorkers(): WorkerRegistration[] {
		return Array.from(this.workers.values());
	}

	/**
	 * Pushes one server message to a registered worker (T5.9). Returns false
	 * when the node is unknown or its socket is not open.
	 */
	sendTo(nodeId: string, msg: ServerMessage): boolean {
		const worker = this.workers.get(nodeId);
		if (!worker || worker.ws.readyState !== WebSocket.OPEN) return false;
		this.send(worker.ws, msg);
		return true;
	}

	getLease(): LeaseState {
		return { ...this.lease };
	}

	getMasterNodeId(): string {
		return this.masterNodeId;
	}
}

// Module-level singleton for test imports
let serverInstance: WSServer | null = null;

export async function startServer(port = WS_PORT, bind = WS_BIND, options: WSServerOptions = {}): Promise<Server> {
	if (serverInstance) {
		throw new Error("Server already running");
	}
	serverInstance = new WSServer(port, bind, options);
	await serverInstance.start();
	return serverInstance.httpServer;
}

export async function stopServer(): Promise<void> {
	if (serverInstance) {
		await serverInstance.stop();
		serverInstance = null;
	}
}

export function getServer(): WSServer | null {
	return serverInstance;
}