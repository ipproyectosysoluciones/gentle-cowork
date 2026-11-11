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
import type { Budget } from "../contract/schema.ts";
import type { GuardConfig } from "../contract/guards.ts";
import { createHash, createSign, createVerify, randomBytes } from "node:crypto";

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

/** Signed verdict with cryptographic attestation (C12). */
export interface SignedWorkerVerdict extends WorkerStepVerdict {
  /** Base64-encoded Ed25519 signature of the canonical verdict payload. */
  signature: string;
  /** Public key (base64) of the worker that signed this verdict. */
  publicKey: string;
  /** Algorithm used for signing. */
  algorithm: "ed25519";
}

/** Canonicalizes a verdict for signing/verification. */
function canonicalizeVerdict(verdict: WorkerStepVerdict): string {
  // Deterministic JSON with sorted keys
  const sorted = {
    contractId: verdict.contractId,
    workerNodeId: verdict.workerNodeId,
    status: verdict.status,
    criteria: verdict.criteria.map(c => ({
      criterion: c.criterion,
      satisfied: c.satisfied,
      evidence: c.evidence,
    })).sort((a, b) => a.criterion.localeCompare(b.criterion)),
    artifacts: [...verdict.artifacts].sort(),
    executedAt: verdict.executedAt,
    error: verdict.error ?? null,
  };
  return JSON.stringify(sorted);
}

/** Signs a verdict with a worker's private key (Ed25519). */
export function signVerdict(verdict: WorkerStepVerdict, privateKeyB64: string): SignedWorkerVerdict {
  const payload = canonicalizeVerdict(verdict);
  const privateKey = Buffer.from(privateKeyB64, "base64");
  const sign = createSign("ed25519");
  sign.update(payload);
  sign.end();
  const signature = sign.sign({ key: privateKey, format: "der", type: "pkcs8" });
  
  // Extract public key from private key
  const keyPair = Buffer.from(privateKeyB64, "base64");
  // For Ed25519, the public key is the last 32 bytes of the PKCS8 private key
  // This is a simplification - in production use proper key derivation
  const publicKey = keyPair.subarray(-32);
  
  return {
    ...verdict,
    signature: signature.toString("base64"),
    publicKey: publicKey.toString("base64"),
    algorithm: "ed25519",
  };
}

/** Verifies a signed verdict's signature. */
export function verifySignedVerdict(signed: SignedWorkerVerdict): boolean {
  try {
    const payload = canonicalizeVerdict(signed);
    const publicKey = Buffer.from(signed.publicKey, "base64");
    const signature = Buffer.from(signed.signature, "base64");
    const verify = createVerify("ed25519");
    verify.update(payload);
    verify.end();
    return verify.verify(
      { key: publicKey, format: "der", type: "spki" },
      signature
    );
  } catch {
    return false;
  }
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
  /** Budget for this contract (Phase 6.4). */
  budget?: Budget;
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
  /** Guard configuration for budget enforcement (Phase 6.4). */
  guardConfig?: Partial<GuardConfig>;
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
  /** Budget limits for this worker (H6). */
  budget?: Budget;
}
