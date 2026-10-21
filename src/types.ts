/**
 * TaskContract — the lightweight orchestration data unit for gentle-cowork.
 *
 * NOT a negotiated gentle-ai contract (the review authority stays with gentle-ai).
 * NOT an SDD artifact (no formal proposal/spec/design documents).
 * An internal data agreement between roles, passed by reference to the ODD spec.
 */

export type CoworkRole = "planner" | "implementer" | "verifier";

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed";

/** Audit trail entry for a contract status transition. */
export interface ContractHistoryEntry {
  status: TaskStatus;
  version: number;
  nodeId: string;
  timestamp: string;
  artifacts?: (string | Record<string, unknown>)[];
  leaseFence?: number;
}

export interface TaskContract {
  /** Unique identifier for this delegation. */
  id: string;

  /** Clear, actionable description of what needs to be done. */
  objective: string;

  /** The specialized role assigned to this task. */
  role: CoworkRole;

  /** Files or directories the agent is permitted to touch. */
  scope: string[];

  /** Criteria that must hold for the task to be considered complete. */
  acceptanceCriteria: string[];

  /** Path to the ODD feature document — the spec is passed BY REFERENCE, never paraphrased. */
  specRef: string;

  /** Artifacts produced (summaries, test reports, verification verdicts). */
  artifacts: string[];

  /** Current lifecycle state of this task. */
  status: TaskStatus;

  /** Monotonic version counter (increments on every status transition under lock). */
  version: number;

  /** Audit trail of all status transitions. */
  history: ContractHistoryEntry[];

  /** Fence token from the lease that was active when entering in_progress. */
  leaseFence?: number;

  /** Worker this contract is assigned to (set by the master on assignment; T5.8). */
  workerNodeId?: string;

  /** Retry count for orphan recovery re-queues (max 3). */
  retryCount?: number;
}

/** Node registration for multi-node coordination. */
export interface NodeRegistration {
  nodeId: string;
  role: "master" | "worker";
  capabilities: ("planner" | "implementer" | "verifier")[];
  startedAt: string;
  lastHeartbeat: string;
  status: "alive" | "stale";
}

/** Lease information with fencing token. */
export interface LeaseInfo {
  holderNodeId: string;
  acquiredAt: string;
  expiresAt: string;
  renewedAt?: string;
  fence: number;
}

/** A verification verdict emitted by cowork-verifier. */
export interface VerifyVerdict {
  /** The TaskContract id this verdict belongs to. */
  contractId: string;

  /** Per-requirement verdict (S# from the ODD spec document). */
  requirements: Array<{
    id: string;
    verdict: "pass" | "fail" | "untested";
    evidence: string;
  }>;

  /** Overall verdict. */
  outcome: "APPROVE" | "CHANGES";

  /** Free-text explanation of the verdict. */
  report: string;
}