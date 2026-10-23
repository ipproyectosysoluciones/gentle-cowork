/**
 * T5.9 — RemoteWorkerClient: WebSocket client for remote implementer nodes.
 *
 * Connects to the master WS server, registers as an implementer, receives
 * assign_step pushes, executes via the injectable StepExecutor, and reports
 * step_result with the full structured verdict. The master applies it to the
 * blackboard as proxy-writer; the client never writes state directly.
 */

import WebSocket from "ws";
import type { StepExecutor, WorkerStepVerdict } from "./types.ts";
import type { TaskContract } from "../types.ts";
import {
	type RegisterWorker,
	type AssignStep,
	type StepResult,
	type Heartbeat,
	type WelcomeMessage,
	type ServerMessage,
	type WorkerVerdictPayload,
} from "../ws/protocol.ts";

/** Configuration options for RemoteWorkerClient. */
export interface RemoteWorkerOptions {
	/** WebSocket server URL (e.g., ws://127.0.0.1:4318). */
	url: string;
	/** Unique node identifier; defaults to a generated worker ID. */
	nodeId?: string;
	/** Step executor that runs assigned contracts (mock in tests, RPC in production). */
	executor: StepExecutor;
	/** Heartbeat interval in milliseconds; defaults to 5000. */
	heartbeatMs?: number;
	/** Reconnection delay in milliseconds; defaults to 1000. */
	reconnectDelayMs?: number;
}

/** Internal state tracking. */
interface ClientState {
	ws: WebSocket | null;
	connecting: boolean;
	stopped: boolean;
	heartbeatTimer: NodeJS.Timeout | null;
	reconnectTimer: NodeJS.Timeout | null;
	startResolve: ((value: void) => void) | null;
	startReject: ((reason: Error) => void) | null;
}

/**
 * RemoteWorkerClient — a WebSocket client for remote implementer workers.
 *
 * Lifecycle:
 *   1. start() — connects, registers, waits for welcome, then resolves.
 *   2. While connected: sends heartbeats, handles assign_step, reports results.
 *   3. On server-initiated disconnect: waits reconnectDelayMs, then reconnects + re-registers.
 *   4. stop() — clears timers, closes socket, prevents further reconnection.
 */
export class RemoteWorkerClient {
	private readonly url: string;
	private readonly nodeId: string;
	private readonly executor: StepExecutor;
	private readonly heartbeatMs: number;
	private readonly reconnectDelayMs: number;
	private state: ClientState;

	constructor(options: RemoteWorkerOptions) {
		this.url = options.url;
		this.nodeId = options.nodeId ?? `remote-worker-${process.pid}-${Date.now()}`;
		this.executor = options.executor;
		this.heartbeatMs = options.heartbeatMs ?? 5000;
		this.reconnectDelayMs = options.reconnectDelayMs ?? 1000;
		this.state = {
			ws: null,
			connecting: false,
			stopped: false,
			heartbeatTimer: null,
			reconnectTimer: null,
			startResolve: null,
			startReject: null,
		};
	}

	/**
	 * Starts the worker: connects to the server, registers, and waits for welcome.
	 * Resolves once the welcome message is received.
	 */
	async start(): Promise<void> {
		if (this.state.stopped) {
			throw new Error("Client has been stopped; create a new instance to restart");
		}
		if (this.state.connecting) {
			throw new Error("Client is already connecting");
		}

		this.state.stopped = false;
		return new Promise<void>((resolve, reject) => {
			this.state.startResolve = resolve;
			this.state.startReject = reject;
			this.connect();
		});
	}

	/**
	 * Stops the worker: clears all timers and closes the WebSocket.
	 * After stop, no reconnection attempts are made.
	 */
	async stop(): Promise<void> {
		this.state.stopped = true;
		this.clearTimers();

		if (this.state.ws) {
			this.state.ws.close(1000, "Client stopped");
			this.state.ws = null;
		}

		// Reject any pending start promise
		if (this.state.startReject) {
			this.state.startReject(new Error("Client stopped before welcome"));
			this.state.startResolve = null;
			this.state.startReject = null;
		}
	}

	/** Initiates a WebSocket connection and sets up handlers. */
	private connect(): void {
		if (this.state.stopped || this.state.connecting) return;

		this.state.connecting = true;
		const ws = new WebSocket(this.url);
		this.state.ws = ws;

		ws.on("open", () => {
			this.log(`Connected to ${this.url}`);
			this.register(ws);
		});

		ws.on("message", (data) => {
			this.handleMessage(ws, data.toString());
		});

		ws.on("close", (code, reason) => {
			this.log(`Connection closed: code=${code}, reason=${reason.toString()}`);
			this.handleClose(code);
		});

		ws.on("error", (err) => {
			this.log(`WS error: ${err.message}`);
			// Error is followed by close; handleClose will manage reconnect
		});
	}

	/** Sends the register_worker message. */
	private register(ws: WebSocket): void {
		const msg: RegisterWorker = {
			type: "register_worker",
			nodeId: this.nodeId,
			role: "worker",
			capabilities: ["implementer"],
			startedAt: new Date().toISOString(),
		};
		ws.send(JSON.stringify(msg));
		this.log(`Sent register_worker for ${this.nodeId}`);
	}

	/** Handles incoming server messages. */
	private handleMessage(ws: WebSocket, raw: string): void {
		let msg: ServerMessage;
		try {
			msg = JSON.parse(raw) as ServerMessage;
		} catch {
			this.log("Failed to parse server message");
			return;
		}

		switch (msg.type) {
			case "welcome":
				this.handleWelcome(msg);
				break;
			case "assign_step":
				this.handleAssignStep(msg);
				break;
			case "error":
				this.log(`Server error: ${msg.code} - ${msg.message}`);
				if (this.state.startReject) {
					this.state.startReject(new Error(`Server error: ${msg.message}`));
				}
				break;
			default:
				this.log(`Unhandled message type: ${(msg as ServerMessage).type}`);
		}
	}

	/** Handles the welcome message — resolves the start promise. */
	private handleWelcome(msg: WelcomeMessage): void {
		this.log(`Received welcome from ${msg.serverNodeId} (protocol v${msg.protocol})`);
		this.state.connecting = false;
		this.startHeartbeats();
		if (this.state.startResolve) {
			this.state.startResolve();
			this.state.startResolve = null;
			this.state.startReject = null;
		}
	}

	/** Handles an assign_step message — executes the contract and reports result. */
	private async handleAssignStep(msg: AssignStep): Promise<void> {
		this.log(`Received assign_step: contract=${msg.contractId}, step=${msg.step.id}`);

		// Reconstruct minimal TaskContract from assign_step payload
		// Use THIS client's nodeId as workerNodeId (the assign_step's workerNodeId is for routing)
		const contract: TaskContract = {
			id: msg.contractId,
			objective: msg.step.objective,
			scope: msg.step.scope,
			acceptanceCriteria: msg.step.acceptanceCriteria,
			specRef: msg.step.specRef ?? "odd/tasks/gentle-cowork-phase5.md",
			role: "implementer",
			workerNodeId: this.nodeId,
			status: "in_progress",
			version: 0,
			history: [],
			artifacts: [],
			retryCount: 0,
		};

		let verdict: WorkerStepVerdict;
		try {
			verdict = await this.executor.execute(contract);
		} catch (err) {
			// Executor threw — synthesize a failed verdict
			const errorMsg = err instanceof Error ? err.message : String(err);
			verdict = {
				contractId: contract.id,
				workerNodeId: this.nodeId,
				status: "failed",
				criteria: [],
				artifacts: [],
				executedAt: new Date().toISOString(),
				error: errorMsg,
			};
		}

		// Send step_result
		await this.sendStepResult(msg, verdict);
	}

	/** Sends the step_result message with the worker verdict. */
	private async sendStepResult(
		assignMsg: AssignStep,
		verdict: WorkerStepVerdict,
	): Promise<void> {
		if (!this.state.ws || this.state.ws.readyState !== WebSocket.OPEN) {
			this.log("Cannot send step_result: socket not open");
			return;
		}

		// Always use THIS client's nodeId for the reported verdict (executor may be shared/mocked)
		const workerVerdict: WorkerVerdictPayload = {
			contractId: verdict.contractId,
			workerNodeId: this.nodeId,
			status: verdict.status,
			criteria: verdict.criteria,
			artifacts: verdict.artifacts,
			executedAt: verdict.executedAt,
			error: verdict.error,
		};

		const artifactSummary = verdict.artifacts.length > 0
			? verdict.artifacts.join(", ")
			: verdict.error ?? "no artifacts";

		const msg: StepResult = {
			type: "step_result",
			contractId: verdict.contractId,
			stepId: assignMsg.step.id,
			artifact: artifactSummary,
			status: verdict.status,
			workerVerdict,
		};

		this.state.ws.send(JSON.stringify(msg));
		this.log(`Sent step_result for ${verdict.contractId} (${verdict.status})`);
	}

	/** Starts the heartbeat timer. */
	private startHeartbeats(): void {
		this.clearHeartbeatTimer();
		this.state.heartbeatTimer = setInterval(() => {
			this.sendHeartbeat();
		}, this.heartbeatMs);
		// Send initial heartbeat immediately
		this.sendHeartbeat();
	}

	/** Sends a single heartbeat. */
	private sendHeartbeat(): void {
		if (!this.state.ws || this.state.ws.readyState !== WebSocket.OPEN) return;

		const msg: Heartbeat = {
			type: "heartbeat",
			nodeId: this.nodeId,
			timestamp: new Date().toISOString(),
		};
		this.state.ws.send(JSON.stringify(msg));
	}

	/** Clears the heartbeat timer. */
	private clearHeartbeatTimer(): void {
		if (this.state.heartbeatTimer) {
			clearInterval(this.state.heartbeatTimer);
			this.state.heartbeatTimer = null;
		}
	}

	/** Clears all timers. */
	private clearTimers(): void {
		this.clearHeartbeatTimer();
		if (this.state.reconnectTimer) {
			clearTimeout(this.state.reconnectTimer);
			this.state.reconnectTimer = null;
		}
	}

	/** Handles WebSocket close — schedules reconnect if not stopped. */
	private handleClose(code: number): void {
		this.clearHeartbeatTimer();
		this.state.connecting = false;
		this.state.ws = null;

		// If we were waiting for welcome, reject the start promise
		if (this.state.startReject) {
			this.state.startReject(new Error(`Connection closed before welcome (code ${code})`));
			this.state.startResolve = null;
			this.state.startReject = null;
		}

		// Reconnect if not stopped and not a clean client-initiated close
		if (!this.state.stopped && code !== 1000) {
			this.scheduleReconnect();
		}
	}

	/** Schedules a reconnection attempt after reconnectDelayMs. */
	private scheduleReconnect(): void {
		if (this.state.stopped) return;

		this.state.reconnectTimer = setTimeout(() => {
			this.log(`Reconnecting after ${this.reconnectDelayMs}ms...`);
			this.connect();
		}, this.reconnectDelayMs);
	}

	/** Logs a message with timestamp. */
	private log(msg: string): void {
		console.error(`[RemoteWorker:${new Date().toISOString()}] ${msg}`);
	}
}