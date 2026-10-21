/**
 * T5.8 — LocalWorker: the local worker orchestration slice.
 *
 * Registers with implementer capability, claims contracts the master
 * assigned to it (in_progress + workerNodeId === mine — assignment state
 * lives on the blackboard, never in WS messages), executes via an injectable
 * StepExecutor, and writes the WorkerStepVerdict + terminal status atomically
 * under a short lease with fence.
 */

import type { Blackboard, NodeRegistration } from "../blackboard.ts";
import type { TaskContract } from "../types.ts";
import type { StepExecutor, WorkerOptions, WorkerStepVerdict } from "./types.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function newNodeId(): string {
  return `worker-${process.pid}-${Date.now()}`;
}

/** The local worker: claims, executes, and verdicts through the blackboard. */
export class LocalWorker {
  private readonly board: Blackboard;
  private readonly executor: StepExecutor;
  private readonly nodeId: string;
  private readonly pollIntervalMs: number;
  private readonly leaseTtlMs: number;

  constructor(options: WorkerOptions) {
    this.board = options.board;
    this.executor = options.executor;
    this.nodeId = options.nodeId ?? newNodeId();
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.leaseTtlMs = options.leaseTtlMs ?? 10_000;
  }

  /** Registers this worker on the blackboard (implementer capability). */
  register(): void {
    const now = new Date().toISOString();
    const node: NodeRegistration = {
      nodeId: this.nodeId,
      role: "worker",
      capabilities: ["implementer"],
      startedAt: now,
      lastHeartbeat: now,
      status: "alive",
    };
    this.board.registerNode(node);
  }

  /** Claims the next contract the master assigned to this worker, if any. */
  claimNext(): TaskContract | undefined {
    this.board.refresh();
    const mine = this.board
      .listContracts()
      .filter((c) => c.role === "implementer" && c.status === "in_progress" && c.workerNodeId === this.nodeId);
    return mine[0];
  }

  /**
   * Executes one assigned contract and writes the verdict + terminal status
   * to the blackboard atomically (one locked updateStatus under a short
   * lease). The write is retried with a fresh lease when the fence was
   * superseded mid-flight; execution itself is never re-run on write retries.
   */
  async executeAssigned(contract: TaskContract): Promise<WorkerStepVerdict> {
    let verdict: WorkerStepVerdict;
    try {
      verdict = await this.executor.execute(contract);
    } catch (error) {
      verdict = {
        contractId: contract.id,
        workerNodeId: this.nodeId,
        status: "failed",
        criteria: [],
        artifacts: [],
        executedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
    this.writeResult(contract, verdict);
    return verdict;
  }

  /** Writes the verdict under a short lease; up to 2 attempts with a fresh fence. */
  private writeResult(contract: TaskContract, verdict: WorkerStepVerdict): boolean {
    const status = verdict.status === "completed" ? "completed" : "failed";
    const record = { type: "worker_verdict", ...verdict };
    for (let attempt = 0; attempt < 2; attempt++) {
      const lease = this.board.acquireLease(this.nodeId, this.leaseTtlMs);
      if (!lease) continue;
      try {
        const updated = this.board.updateStatus(
          contract.id,
          status,
          this.nodeId,
          verdict.artifacts,
          lease.fence,
          [record],
        );
        if (updated) {
          this.board.releaseLease(this.nodeId, lease.fence);
          return true;
        }
      } catch {
        // Fence superseded mid-flight: retry with a fresh lease.
      }
    }
    return false;
  }

  /**
   * Worker loop: refresh → heartbeat → claim → execute → report, until the
   * done predicate turns true or the maxMs deadline expires. The done
   * predicate reads the worker's own board handle (its loop refreshes it).
   */
  async runUntil(done: () => boolean, opts: { maxMs?: number } = {}): Promise<void> {
    const deadline = Date.now() + (opts.maxMs ?? 30_000);
    while (!done()) {
      if (Date.now() >= deadline) return;
      this.board.refresh();
      this.board.heartbeat(this.nodeId);
      const claimed = this.claimNext();
      if (claimed) {
        await this.executeAssigned(claimed);
      }
      await sleep(this.pollIntervalMs);
    }
  }
}
