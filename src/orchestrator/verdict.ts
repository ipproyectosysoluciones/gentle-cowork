/**
 * T5.8 — Worker verdict transport over the blackboard.
 *
 * The worker writes its verdict as a record artifact on the terminal status
 * transition's history entry (atomic under the blackboard lock). The master
 * reads it back by scanning the history — the blackboard schema is unchanged.
 */

import type { TaskContract } from "../types.ts";
import type { MasterVerifier, WorkerStepVerdict } from "./types.ts";

/** Minimal shape guard for a verdict record stored in a history entry. */
function isWorkerStepVerdict(value: unknown): value is WorkerStepVerdict {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.contractId === "string" &&
    typeof v.workerNodeId === "string" &&
    (v.status === "completed" || v.status === "failed") &&
    Array.isArray(v.criteria) &&
    Array.isArray(v.artifacts) &&
    typeof v.executedAt === "string"
  );
}

/** Reads the worker verdict a worker wrote into the contract's blackboard history. */
export function extractWorkerVerdict(contract: TaskContract): WorkerStepVerdict | null {
  for (let i = contract.history.length - 1; i >= 0; i--) {
    const artifacts = contract.history[i].artifacts;
    if (!artifacts) continue;
    for (let j = artifacts.length - 1; j >= 0; j--) {
      const artifact = artifacts[j];
      if (typeof artifact !== "object" || artifact === null) continue;
      const record = artifact as Record<string, unknown>;
      if (record.type === "worker_verdict" && isWorkerStepVerdict(record)) {
        return record;
      }
    }
  }
  return null;
}

/**
 * Structural default verifier (verifier authority stays co-located with the
 * master): every acceptance criterion must appear in the worker's verdict and
 * be marked satisfied with evidence, and the execution must have completed.
 * A model-backed verifier plugs in via the master's `verify` option.
 */
export const defaultVerifier: MasterVerifier = (contract, verdict) => {
  if (verdict.status !== "completed") {
    return { accepted: false, reason: verdict.error ?? "worker reported failure" };
  }
  const unsatisfied = verdict.criteria.filter((c) => !c.satisfied);
  if (unsatisfied.length > 0) {
    return {
      accepted: false,
      reason: `criteria not satisfied: ${unsatisfied.map((c) => c.criterion).join("; ")}`,
    };
  }
  const missing = contract.acceptanceCriteria.filter(
    (criterion) => !verdict.criteria.some((c) => c.criterion === criterion),
  );
  if (missing.length > 0) {
    return { accepted: false, reason: `criteria without evidence: ${missing.join("; ")}` };
  }
  return { accepted: true, reason: "all criteria satisfied with evidence" };
};
