/**
 * TaskContract — the lightweight orchestration data unit for gentle-cowork.
 *
 * NOT a negotiated gentle-ai contract (the review authority stays with gentle-ai).
 * NOT an SDD artifact (no formal proposal/spec/design documents).
 * An internal data agreement between roles, passed by reference to the ODD spec.
 */

export type CoworkRole = "planner" | "implementer" | "verifier";

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed";

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
