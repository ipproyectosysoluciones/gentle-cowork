/**
 * T5.9 — RemoteWorkerBridge: master-side glue for remote workers.
 *
 * The bridge owns its transport (WSServer) and mirrors WS events onto the
 * blackboard. The blackboard is the ONLY coordination point (L15 amendment 2).
 * The master orchestrator delegates to it; remote workers connect via WS.
 */

import { WSServer, type WorkerRegistrationSummary } from "../ws/server.ts";
import { WS_BIND, type StepResult } from "../ws/protocol.ts";
import { openBlackboard, type Blackboard, type NodeRegistration } from "../blackboard.ts";
import { extractWorkerVerdict } from "./verdict.ts";
import type { TaskContract, TaskStatus } from "../types.ts";
import type { WorkerStepVerdict } from "./types.ts";

/** Configuration options for RemoteWorkerBridge. */
export interface RemoteWorkerBridgeOptions {
  /** The blackboard the master coordinates through. */
  board: Blackboard;
  /** WebSocket server port; 0 = ephemeral. */
  port?: number;
  /** Bind address; defaults to WS_BIND (127.0.0.1). */
  bind?: string;
  /** Master node identifier; defaults to generated ID. */
  nodeId?: string;
  /** Master heartbeat interval in milliseconds; defaults to 5000. */
  heartbeatMs?: number;
}

/** Internal state. */
interface BridgeState {
  server: WSServer | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  running: boolean;
  /** NodeIds of workers that are connected via WS (updated via callbacks). */
  wsConnected: Set<string>;
}

/**
 * RemoteWorkerBridge — master-side WebSocket transport for remote implementers.
 *
 * Lifecycle:
 *   1. Constructor builds the WSServer with callbacks that mirror events to the blackboard.
 *   2. start() — starts the server, begins master heartbeat.
 *   3. While running: syncAssignments() routes pending contracts to WS-connected workers.
 *   4. stop() — clears timers, stops server.
 */
export class RemoteWorkerBridge {
  private readonly board: Blackboard;
  private readonly port: number;
  private readonly bindAddress: string;
  private readonly nodeId: string;
  private readonly heartbeatMs: number;
  private state: BridgeState;

  constructor(options: RemoteWorkerBridgeOptions) {
    this.board = options.board;
    this.port = options.port ?? 0;
    this.bindAddress = options.bind ?? WS_BIND;
    this.nodeId = options.nodeId ?? `master-${process.pid}-${Date.now()}`;
    this.heartbeatMs = options.heartbeatMs ?? 5_000;
    this.state = {
      server: null,
      heartbeatTimer: null,
      running: false,
      wsConnected: new Set(),
    };
  }

  /** WebSocket server URL (available after start). */
  get url(): string {
    if (!this.state.server) {
      throw new Error("Bridge not started; url available after start()");
    }
    const addr = this.state.server.httpServer.address();
    if (!addr || typeof addr === "string") {
      throw new Error("Server address not available");
    }
    // Bind address might be 0.0.0.0 or :: — clients connect to 127.0.0.1 or localhost
    const host = this.bindAddress === "0.0.0.0" || this.bindAddress === "::" ? "127.0.0.1" : this.bindAddress;
    return `ws://${host}:${addr.port}`;
  }

  /** Starts the WebSocket server and master heartbeat. */
  async start(): Promise<void> {
    if (this.state.running) return;

    const server = new WSServer(this.port, this.bindAddress, {
      onWorkerRegistered: (reg) => this.handleWorkerRegistered(reg),
      onStepResult: (msg, senderNodeId) => this.handleStepResult(msg, senderNodeId),
      onHeartbeat: (nodeId) => this.handleHeartbeat(nodeId),
    });

    await server.start();
    this.state.server = server;
    this.state.running = true;

    // Register this master on the blackboard
    const now = new Date().toISOString();
    this.board.registerNode({
      nodeId: this.nodeId,
      role: "master",
      capabilities: ["planner", "verifier"],
      startedAt: now,
      lastHeartbeat: now,
      status: "alive",
    });

    // Start master heartbeat
    this.startHeartbeat();
    // Send initial heartbeat immediately
    this.board.heartbeat(this.nodeId);
  }

  /** Stops the bridge: clears timers and shuts down the server. */
  async stop(): Promise<void> {
    if (!this.state.running) return;

    this.state.running = false;
    this.clearHeartbeat();

    if (this.state.server) {
      await this.state.server.stop();
      this.state.server = null;
    }
  }

  /** Assigns pending implementer contracts to WS-connected alive workers. Returns count assigned. */
  syncAssignments(): number {
    if (!this.state.running || !this.state.server) return 0;

    this.board.refresh();

    // Get WS-connected worker nodeIds (tracked via callbacks)
    const wsConnected = this.state.wsConnected;

    // Get alive implementer workers from blackboard that are ALSO WS-connected
    const candidates = this.board
      .getNodes()
      .filter(
        (n) =>
          n.role === "worker" &&
          n.status === "alive" &&
          n.capabilities.includes("implementer") &&
          wsConnected.has(n.nodeId),
      )
      .sort((a, b) => Date.parse(b.lastHeartbeat) - Date.parse(a.lastHeartbeat));

    if (candidates.length === 0) return 0;

    const pending = this.board
      .listContracts()
      .filter((c) => c.role === "implementer" && c.status === "pending");

    let assigned = 0;
    for (const contract of pending) {
      const worker = this.pickWorker(candidates);
      if (!worker) break;

      try {
        const updated = this.board.assignContract(contract.id, worker.nodeId);
        if (updated) {
          // Push assign_step to the worker via WS (best-effort notification)
          const pushed = this.state.server!.sendTo(worker.nodeId, {
            type: "assign_step",
            contractId: contract.id,
            step: {
              id: contract.id,
              objective: contract.objective,
              scope: contract.scope,
              acceptanceCriteria: contract.acceptanceCriteria,
              specRef: contract.specRef,
            },
            workerNodeId: worker.nodeId,
          });
          if (!pushed) {
            // Worker socket not open; the contract was assigned but push failed.
            // Next syncAssignments round will retry (contract is now in_progress).
            this.log(`assign_step push failed for ${worker.nodeId} (contract ${contract.id})`);
          }
          assigned += 1;
        }
      } catch {
        // Fence superseded mid-round; stop this round.
        break;
      }
    }
    return assigned;
  }

  /** Least-loaded worker by in_progress count; ties break on freshest heartbeat (input order). */
  private pickWorker(workers: NodeRegistration[]): NodeRegistration | null {
    const contracts = this.board.listContracts();
    const load = new Map<string, number>();
    for (const c of contracts) {
      if (c.status === "in_progress" && c.workerNodeId) {
        load.set(c.workerNodeId, (load.get(c.workerNodeId) ?? 0) + 1);
      }
    }
    let best: NodeRegistration | null = null;
    let bestLoad = Number.POSITIVE_INFINITY;
    for (const w of workers) {
      const l = load.get(w.nodeId) ?? 0;
      if (l < bestLoad) {
        best = w;
        bestLoad = l;
      }
    }
    return best;
  }

  /** Starts the master heartbeat timer. */
  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.state.heartbeatTimer = setInterval(() => {
      if (this.state.running) {
        this.board.heartbeat(this.nodeId);
      }
    }, this.heartbeatMs);
  }

  /** Clears the heartbeat timer. */
  private clearHeartbeat(): void {
    if (this.state.heartbeatTimer) {
      clearInterval(this.state.heartbeatTimer);
      this.state.heartbeatTimer = null;
    }
  }

  /** Internal logging. */
  private log(msg: string): void {
    console.error(`[Bridge:${new Date().toISOString()}] ${msg}`);
  }

  /** Callback: worker registered → mirror to blackboard and track WS connection. */
  handleWorkerRegistered(reg: WorkerRegistrationSummary): void {
    const node: NodeRegistration = {
      nodeId: reg.nodeId,
      role: reg.role,
      capabilities: reg.capabilities,
      startedAt: reg.startedAt,
      lastHeartbeat: new Date().toISOString(),
      status: "alive",
    };
    this.board.registerNode(node);
    this.state.wsConnected.add(reg.nodeId);
  }

  /** Callback: heartbeat from worker → mirror to blackboard. */
  handleHeartbeat(nodeId: string): void {
    this.board.heartbeat(nodeId);
    // Heartbeat implies WS connection is alive
    this.state.wsConnected.add(nodeId);
  }

  /** Callback: step_result from worker → apply to blackboard with verdict. */
  handleStepResult(msg: StepResult, senderNodeId: string): void {
    // Refresh to get latest contract state (other processes may have written)
    this.board.refresh();

    const contract = this.board.getContract(msg.contractId);
    if (!contract) {
      // Contract doesn't exist — ignore (idempotent)
      return;
    }

    // Only process if contract is in_progress (guard against duplicate/stale)
    if (contract.status !== "in_progress") {
      return;
    }

    // Build or extract the worker verdict
    let verdict: WorkerStepVerdict;
    if (msg.workerVerdict) {
      // Use the structured verdict from the worker
      verdict = {
        contractId: msg.workerVerdict.contractId,
        workerNodeId: senderNodeId, // Bridge stamps with sender nodeId (authoritative)
        status: msg.workerVerdict.status,
        criteria: msg.workerVerdict.criteria,
        artifacts: msg.workerVerdict.artifacts,
        executedAt: msg.workerVerdict.executedAt,
        error: msg.workerVerdict.error,
      };
    } else {
      // Synthesize a minimal verdict from the step_result
      verdict = {
        contractId: msg.contractId,
        workerNodeId: senderNodeId,
        status: msg.status,
        criteria: [],
        artifacts: msg.artifact ? [msg.artifact] : [],
        executedAt: new Date().toISOString(),
        error: "no structured verdict provided",
      };
    }

    // Update contract status on blackboard with the verdict as a history artifact
    // presentedFence omitted (master writes as authority), recordArtifacts carries the verdict
    this.board.updateStatus(
      msg.contractId,
      msg.status,
      senderNodeId,
      undefined, // artifacts (contract.artifacts not updated by verdict)
      undefined, // presentedFence (master is authority)
      [{ type: "worker_verdict", ...verdict }],
    );
  }
}