/**
 * T5.8 — Master Orchestration Slice: orchestration types.
 *
 * The blackboard is the ONLY coordination point (L15 amendment 2): the
 * master seeds and assigns contracts, workers claim, execute, and write
 * their verdict back to the blackboard, and the master reads verdicts and
 * aggregates them into an APPROVED/CHANGES report. WS routing (T5.6) stays
 * notification-only — no state is duplicated in WS messages.
 */

import type { Blackboard } from "../blackboard.ts";
import type { CoworkRole, TaskContract, TaskStatus } from "../types.ts";

/** The verdict a worker writes to the blackboard after executing one contract. */
export interface WorkerStepVerdict {
  /** The TaskContract id this verdict belongs to. */
  contractId: string;
  /** The worker node that executed the step. */
  workerNodeId: string;
  /** Execution outcome reported by the worker. */
  status: "completed" | "failed";
  /** Per-acceptance-criterion self-report with evidence. */
  criteria: Array<{ criterion: string; satisfied: boolean; evidence: string }>;
  /** Artifacts produced (file paths, summaries). */
  artifacts: string[];
  /** ISO timestamp of the execution. */
  executedAt: string;
  /** Error detail when status is failed. */
  error?: string;
}

/** Executes one assigned contract on behalf of a worker. Injectable; tests use mocks. */
export interface StepExecutor {
  execute(contract: TaskContract): Promise<WorkerStepVerdict>;
}

/** Result of the master's verification of one worker verdict. */
export interface MasterVerifierResult {
  accepted: boolean;
  reason: string;
}

/**
 * Master-side verification of one worker verdict before aggregation.
 * Verification authority stays co-located with the master (never on workers).
 */
export type MasterVerifier = (contract: TaskContract, verdict: WorkerStepVerdict) => MasterVerifierResult;

/** The master's aggregated report over a delegated cycle. */
export interface OrchestrationReport {
  outcome: "APPROVED" | "CHANGES";
  contracts: Array<{
    id: string;
    objective: string;
    status: TaskStatus;
    accepted?: boolean;
    reason?: string;
    verdict?: WorkerStepVerdict;
  }>;
}

/** A step the master seeds as a pending implementer contract. */
export interface ContractSeed {
  objective: string;
  scope: string[];
  acceptanceCriteria: string[];
  specRef: string;
  role?: CoworkRole;
}

/** Options for the MasterOrchestrator. */
export interface MasterOptions {
  /** The blackboard the master owns orchestration over. */
  board: Blackboard;
  /** Master node id; defaults to master-<pid>-<ts>. */
  nodeId?: string;
  /** Poll interval for the orchestration loop, in ms. */
  pollIntervalMs?: number;
  /** Overall budget for runCycle before reporting with whatever is terminal. */
  totalTimeoutMs?: number;
  /** Verifier for worker verdicts; defaults to the structural defaultVerifier. */
  verify?: MasterVerifier;
}

/** Options for the LocalWorker. */
export interface WorkerOptions {
  /** The blackboard the worker coordinates through. */
  board: Blackboard;
  /** The executor that runs assigned contracts (mock in tests, RPC in production). */
  executor: StepExecutor;
  /** Worker node id; defaults to worker-<pid>-<ts>. */
  nodeId?: string;
  /** Poll interval for the worker loop, in ms. */
  pollIntervalMs?: number;
  /** Short write lease TTL, in ms. */
  leaseTtlMs?: number;
}
