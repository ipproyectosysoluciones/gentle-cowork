/**
 * T5.8 — MasterOrchestrator: the local master orchestration slice.
 *
 * Maintains the global blackboard (openBlackboard), manages the worker pool
 * (the T5.3 node registry), distributes steps (assignment state rides the
 * contract on the blackboard), and aggregates verdicts (the T5.2 merge +
 * verdict extraction). The blackboard is the only coordination point; the
 * worker pool is discovered from the registry, never from WS messages.
 */

import type { Blackboard, NodeRegistration } from "../blackboard.ts";
import type { CoworkRole, TaskContract } from "../types.ts";
import { defaultVerifier, extractWorkerVerdict } from "./verdict.ts";
import type {
  ContractSeed,
  MasterOptions,
  MasterVerifierResult,
  OrchestrationReport,
} from "./types.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function newNodeId(prefix: string): string {
  return `${prefix}-${process.pid}-${Date.now()}`;
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "failed"]);

/** The local master: seeds, assigns, and aggregates through the blackboard. */
export class MasterOrchestrator {
  private readonly board: Blackboard;
  private readonly nodeId: string;
  private readonly pollIntervalMs: number;
  private readonly totalTimeoutMs: number;
  private readonly verify: (contract: TaskContract, verdict: NonNullable<OrchestrationReport["contracts"][number]["verdict"]>) => MasterVerifierResult;
  private readonly delegatedIds: string[] = [];
  private nextId = 1;

  constructor(options: MasterOptions) {
    this.board = options.board;
    this.nodeId = options.nodeId ?? newNodeId("master");
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.totalTimeoutMs = options.totalTimeoutMs ?? 30_000;
    this.verify = options.verify ?? defaultVerifier;
  }

  /** Registers this master on the blackboard (planner + verifier capabilities). */
  register(): void {
    const now = new Date().toISOString();
    const node: NodeRegistration = {
      nodeId: this.nodeId,
      role: "master",
      capabilities: ["planner", "verifier"],
      startedAt: now,
      lastHeartbeat: now,
      status: "alive",
    };
    this.board.registerNode(node);
  }

  /** Seeds one pending contract per step on the blackboard. Returns the stored contracts. */
  delegate(seeds: ContractSeed[]): TaskContract[] {
    const lease = this.board.acquireLease(this.nodeId);
    if (!lease) throw new Error(`gentle-cowork master ${this.nodeId} could not acquire a lease to delegate`);
    const stored: TaskContract[] = [];
    try {
      for (const seed of seeds) {
        const now = new Date().toISOString();
        const contract: TaskContract = {
          id: `gc-${this.nextId++}`,
          objective: seed.objective,
          role: (seed.role ?? "implementer") as CoworkRole,
          scope: [...seed.scope],
          acceptanceCriteria: [...seed.acceptanceCriteria],
          specRef: seed.specRef,
          artifacts: [],
          status: "pending",
          version: 1,
          history: [{ status: "pending", version: 1, nodeId: this.nodeId, timestamp: now }],
          retryCount: 0,
        };
        this.board.putContract(contract, lease.fence);
        this.delegatedIds.push(contract.id);
        const back = this.board.getContract(contract.id);
        if (back) stored.push(back);
      }
    } finally {
      this.board.releaseLease(this.nodeId, lease.fence);
    }
    return stored;
  }

  /**
   * Routes pending implementer contracts to alive implementer workers.
   * The master owns lease arbitration: it takes a fresh lease per assignment
   * round (fence discipline — a superseded writer is rejected by the board).
   * Returns the number of contracts assigned this round.
   */
  assignPending(): number {
    this.board.refresh();
    const workers = this.board
      .getNodes()
      .filter((n) => n.role === "worker" && n.status === "alive" && n.capabilities.includes("implementer"))
      .sort((a, b) => Date.parse(b.lastHeartbeat) - Date.parse(a.lastHeartbeat));
    if (workers.length === 0) return 0;

    const pending = this.board.listContracts().filter((c) => c.role === "implementer" && c.status === "pending");
    let assigned = 0;
    for (const contract of pending) {
      const worker = this.pickWorker(workers);
      if (!worker) break;
      try {
        const updated = this.board.assignContract(contract.id, worker.nodeId);
        if (updated) assigned += 1;
      } catch {
        // Fence superseded mid-round (a worker is writing): skip; the next
        // round re-acquires a fresh lease and retries the assignment.
        break;
      }
    }
    return assigned;
  }

  /** Least-loaded worker by in_progress count; ties break on the input order (freshest heartbeat first). */
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

  /**
   * Aggregates the cycle's verdicts into an APPROVED/CHANGES report.
   * Scans every implementer contract on the blackboard (the master is the
   * only seeder in the local slice); verification authority is co-located.
   */
  aggregate(): OrchestrationReport {
    this.board.refresh();
    const contracts = this.board.listContracts().filter((c) => c.role === "implementer");
    const entries = contracts.map((contract) => {
      const verdict = extractWorkerVerdict(contract);
      if (verdict) {
        const check = this.verify(contract, verdict);
        return {
          id: contract.id,
          objective: contract.objective,
          status: contract.status,
          accepted: check.accepted,
          reason: check.reason,
          verdict,
        };
      }
      if (contract.status === "completed" || contract.status === "failed") {
        return {
          id: contract.id,
          objective: contract.objective,
          status: contract.status,
          accepted: false,
          reason: contract.status === "completed"
            ? "terminal without a worker verdict"
            : "failed without a worker verdict",
        };
      }
      return {
        id: contract.id,
        objective: contract.objective,
        status: contract.status,
        reason: `still ${contract.status} (timeout or unclaimed)`,
      };
    });
    const approved = entries.every(
      (e) => e.status === "completed" && e.accepted === true,
    ) && entries.length > 0;
    return { outcome: approved ? "APPROVED" : "CHANGES", contracts: entries };
  }

  /**
   * One full orchestration cycle: register → delegate → assign → poll until
   * every delegated contract is terminal (or the budget expires) → aggregate.
   * Runs concurrently with worker loops — coordination is the blackboard only.
   */
  async runCycle(
    seeds: ContractSeed[],
    opts: { totalTimeoutMs?: number } = {},
  ): Promise<OrchestrationReport> {
    this.register();
    this.board.acquireLease(this.nodeId);
    this.delegate(seeds);

    const budgetMs = opts.totalTimeoutMs ?? this.totalTimeoutMs;
    const deadline = Date.now() + budgetMs;
    const ids = new Set(this.delegatedIds);

    const allTerminal = (): boolean => {
      this.board.refresh();
      const tracked = this.board.listContracts().filter((c) => ids.has(c.id));
      return tracked.length === ids.size && tracked.every((c) => TERMINAL_STATUSES.has(c.status));
    };

    while (!allTerminal()) {
      if (Date.now() >= deadline) break;
      this.board.heartbeat(this.nodeId);
      this.assignPending();
      await sleep(this.pollIntervalMs);
    }
    return this.aggregate();
  }
}
