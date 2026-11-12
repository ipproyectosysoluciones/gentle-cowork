/**
 * TaskContract — the lightweight orchestration data unit for gentle-cowork.
 *
 * NOT a negotiated gentle-ai contract (the review authority stays with gentle-ai).
 * NOT an SDD artifact (no formal proposal/spec/design documents).
 * An internal data agreement between roles, passed by reference to the ODD spec.
 */

export type CoworkRole = "planner" | "implementer" | "verifier";

/**
 * Validates and normalizes a path to prevent traversal attacks.
 * Returns normalized path relative to project root, or throws.
 */
function validateScopePath(projectRoot: string, path: string): string {
  const normalized = normalize(path);
  
  // Must not be absolute (unless it's within project root)
  if (isAbsolute(normalized) && !normalized.startsWith(resolve(projectRoot))) {
    throw new Error(`Scope path must be within project root: ${path}`);
  }
  
  // Check for directory traversal attempts
  const rel = relative(resolve(projectRoot), resolve(projectRoot, normalized));
  if (rel.startsWith("..") || normalized.includes("..")) {
    throw new Error(`Path traversal detected in scope: ${path}`);
  }
  
  return normalized;
}

/**
 * Validates an artifact path/reference.
 * Allows strings (file paths) and objects (structured artifacts).
 */
function validateArtifact(projectRoot: string, artifact: string | Record<string, unknown>): void {
  if (typeof artifact === "string") {
    validateScopePath(projectRoot, artifact);
  } else if (typeof artifact === "object" && artifact !== null) {
    // Structured artifact - validate any path-like fields
    for (const [key, value] of Object.entries(artifact)) {
      if (typeof value === "string" && (key.includes("path") || key.includes("file"))) {
        validateScopePath(projectRoot, value);
      }
    }
  }
}

/**
 * Validates specRef - must be a relative path to an ODD feature document.
 */
function validateSpecRef(projectRoot: string, specRef: string): string {
  const normalized = normalize(specRef);
  if (!normalized.startsWith("odd/tasks/") && !normalized.startsWith("./odd/tasks/")) {
    throw new Error(`specRef must point to an ODD feature document: ${specRef}`);
  }
  // Ensure it's within project root
  const fullPath = resolve(projectRoot, normalized);
  if (!fullPath.startsWith(resolve(projectRoot))) {
    throw new Error(`specRef path traversal detected: ${specRef}`);
  }
  return normalized;
}

/**
 * Creates a TaskContract with full path validation (C10, C11).
 * Throws if any path is invalid or attempts traversal.
 */
export function createTaskContract(
  projectRoot: string,
  contract: Omit<TaskContract, "id" | "version" | "history" | "status" | "leaseFence" | "workerNodeId" | "retryCount">
): TaskContract {
  // Validate all paths
  const validatedScope = contract.scope.map((p) => validateScopePath(projectRoot, p));
  for (const artifact of contract.artifacts) {
    validateArtifact(projectRoot, artifact);
  }
  const validatedSpecRef = validateSpecRef(projectRoot, contract.specRef);
  
  const now = new Date().toISOString();
  return {
    ...contract,
    id: `gc-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    scope: validatedScope,
    specRef: validatedSpecRef,
    artifacts: [],
    status: "pending",
    version: 1,
    history: [{
      status: "pending",
      version: 1,
      nodeId: "master",
      timestamp: now,
    }],
  };
}

import type { Budget } from "./contract/schema.ts";
import { resolve, normalize, isAbsolute, relative } from "node:path";

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "paused";

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

  /** Budget limits for this contract (Phase 6.4). */
  budget?: Budget;
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

// ============================================================================
// Phase 7.4 — Validation Suites Types
// ============================================================================

/** A single finding from a validation suite. */
export interface ValidationFinding {
  /** Unique identifier for this finding. */
  id: string;
  /** Severity level. */
  severity: "info" | "warning" | "error";
  /** Human-readable message. */
  message: string;
  /** Optional location (file:line). */
  location?: string;
  /** Optional suggestion for fixing. */
  suggestion?: string;
}

/** Result of running a validation suite. */
export interface ValidationResult {
  /** The suite that produced this result. */
  suiteId: string;
  /** Whether the suite passed. */
  passed: boolean;
  /** Individual findings from the suite. */
  findings: ValidationFinding[];
  /** Optional metadata (duration, etc.). */
  metadata?: Record<string, unknown>;
}

/** Context passed to validation suites. Shape depends on the suite. */
export interface ValidationContext {
  /** File contents for static analysis (SAST). */
  files?: Record<string, string>;
  /** Metrics for performance/maintainability suites. */
  metrics?: {
    wallTimeMs?: number;
    memoryMB?: number;
    cpuPercent?: number;
    cyclomaticComplexity?: number;
    coupling?: number;
    coverage?: number;
  };
  /** Thresholds for threshold-based suites. */
  thresholds?: {
    wallTimeMs?: number;
    memoryMB?: number;
    cpuPercent?: number;
    cyclomaticComplexity?: number;
    coupling?: number;
    coverage?: number;
  };
  /** Arbitrary additional data. */
  [key: string]: unknown;
}

/** A validation suite that can be run against a codebase/context. */
export interface ValidationSuite {
  /** Unique identifier (e.g., "sast-basic"). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Version of the suite. */
  version: string;
  /**
   * Runs the suite against the given context.
   * Context shape depends on the suite (files, metrics, thresholds, etc.)
   */
  run(context: ValidationContext): Promise<ValidationResult>;
}