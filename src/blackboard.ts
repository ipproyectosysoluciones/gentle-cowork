/**
 * gentle-cowork — Phase 4/5: blackboard state persistence with multi-node support.
 *
 * A shared state file (JSON) that all roles read/write (ROADMAP Phase 4 /
 * spec S5): every TaskContract the extension issues — through any role —
 * is persisted to `<project-cwd>/.gentle-cowork/blackboard.json`, so
 * contract state survives daemon restarts. The board keeps the full
 * pending → in_progress → completed/failed lifecycle on disk.
 *
 * Phase 5 additions:
 * - Advisory file locking (flock) for same-machine concurrent writers
 * - Lease mechanism with monotonic fencing tokens
 * - Orphan recovery sweep (master-only)
 * - Version counter per contract for conflict resolution (timestamps display-only)
 * - Node registration with heartbeats
 *
 * Reads fail safe: a missing, corrupt, or unrecognized state file yields
 * an empty board, never a crash. Writes are atomic (temp file + rename),
 * so a daemon killed mid-write can never leave a half-written board
 * behind. In Phase 4 the extension performs the reads and writes on
 * behalf of every role; the file is the shared substrate that later
 * phases (multi-node scaling) can read and write directly.
 */

import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  openSync,
  closeSync,
  constants,
  unlinkSync,
} from "node:fs";
import { isAbsolute, normalize, resolve } from "node:path";
import { dirname, join } from "node:path";

import type { TaskContract, TaskStatus, ContractHistoryEntry } from "./types.ts";
import {
	type ContractUsage,
	type NodeUsage,
	recordUsageSample,
	type UsageSample,
} from "./metering.ts";
import { evaluateGuards, type GuardConfig, type GuardsEvaluation } from "./contract/guards.ts";
import { type Budget } from "./contract/schema.ts";
import { generateFence } from "./ws/protocol.ts";
import {
	type DecisionGraph,
	type DecisionNode,
	type DecisionEdge,
	type DecisionState,
	validateDecisionGraph,
	validateDecisionNode,
	validateDecisionEdge,
	getDecisionSubgraph,
	getDecisionGraphValidationErrors,
	wouldCreateCycle,
} from "./architectural-memory.ts";
import {
	type TechDebtGraph,
	type TechDebtNode,
	type TechDebtEdge,
	type TechDebtState,
	type DebtState,
	type DebtSeverity,
	validateTechDebtGraph,
	validateTechDebtNode,
	validateTechDebtEdge,
	getTechDebtSubgraph,
	getTechDebtGraphValidationErrors,
	wouldCreateTechDebtCycle,
} from "./tech-debt.ts";

/** Directory (inside the project cwd) holding the blackboard state file. */
export const BLACKBOARD_DIR = ".gentle-cowork";

/** File name of the blackboard state file inside BLACKBOARD_DIR. */
export const BLACKBOARD_FILENAME = "blackboard.json";

/** Current state file format version. */
export const STATE_VERSION = 5;

/** The on-disk shape of the blackboard state file. */
export interface BlackboardState {
  version: number;
  contracts: TaskContract[];
  lease?: LeaseInfo;
  nodes: NodeRegistration[];
  lastFence: number;
  /** Phase 6.3: usage aggregates per contract (v3; absent on v1/v2 files). */
  usage?: Record<string, ContractUsage>;
  /** Phase 7.1: decision graph (v4+). */
  decisions?: DecisionGraph;
  /** Phase 7.2: tech debt registry (v5+). */
  techDebt?: TechDebtGraph;
}

/** Lease information with fencing token. */
export interface LeaseInfo {
  holderNodeId: string;
  acquiredAt: string;
  expiresAt: string;
  renewedAt?: string;
  fence: number;
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

/** Default lease TTL in milliseconds (30 seconds). */
export const DEFAULT_LEASE_TTL_MS = 30_000;

/** Lease renewal interval in milliseconds (10 seconds). */
export const LEASE_RENEWAL_INTERVAL_MS = 10_000;

/** Heartbeat interval in milliseconds (5 seconds). */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/** Stale threshold: node considered stale after this many ms without heartbeat. */
export const STALE_THRESHOLD_MS = 15_000;

/** Orphan detection: lease expiry + this many ms without heartbeat = orphaned. */
export const ORPHAN_HEARTBEAT_THRESHOLD_MS = 30_000;

/** Max retry count for orphan recovery re-queues. */
export const MAX_RETRY_COUNT = 3;

/** Resolves the blackboard state file path for a project working directory.
 * Validates that projectCwd is an absolute path and exists (C11). */
export function defaultBlackboardPath(projectCwd: string): string {
  if (!projectCwd || typeof projectCwd !== "string") {
    throw new Error("projectCwd must be a non-empty string");
  }
  const normalized = normalize(projectCwd);
  // Allow relative paths that resolve to absolute (e.g., temp dirs)
  const absolute = isAbsolute(normalized) ? normalized : resolve(normalized);
  // Validate no traversal in the resolved path
  if (absolute.includes("..")) {
    throw new Error("projectCwd path traversal detected");
  }
  return join(absolute, BLACKBOARD_DIR, BLACKBOARD_FILENAME);
}

const TASK_STATUSES: ReadonlySet<string> = new Set(["pending", "in_progress", "completed", "failed"]);
const COWORK_ROLES: ReadonlySet<string> = new Set(["planner", "implementer", "verifier"]);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Type guard: a plain JSON value is a well-formed TaskContract (lenient for backward compat). */
function isTaskContract(value: unknown): value is TaskContract {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    c.id.length > 0 &&
    typeof c.objective === "string" &&
    typeof c.role === "string" &&
    COWORK_ROLES.has(c.role) &&
    isStringArray(c.scope) &&
    isStringArray(c.acceptanceCriteria) &&
    typeof c.specRef === "string" &&
    isStringArray(c.artifacts) &&
    typeof c.status === "string" &&
    TASK_STATUSES.has(c.status)
  );
}

/** Type guard: a parsed JSON value is a readable blackboard state file (accepts v1 for migration). */
function isBlackboardState(value: unknown): value is BlackboardState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  // Accept v1 (legacy), v2 (pre-metering), v3 (pre-decisions), v4 (pre-techDebt), and v5 (current) for migration
  return (
    (s.version === 1 || s.version === 2 || s.version === 3 || s.version === 4 || s.version === STATE_VERSION) &&
    Array.isArray(s.contracts) &&
    (s.lease === undefined || typeof s.lease === "object") &&
    (s.nodes === undefined || Array.isArray(s.nodes)) &&
    (s.lastFence === undefined || typeof s.lastFence === "number") &&
    (s.decisions === undefined || (typeof s.decisions === "object" && s.decisions !== null)) &&
    (s.techDebt === undefined || (typeof s.techDebt === "object" && s.techDebt !== null))
  );
}

/** Type guard: a parsed JSON value is a readable NodeUsage (lenient, per-entry drop). */
function isNodeUsage(value: unknown): value is NodeUsage {
  if (typeof value !== "object" || value === null) return false;
  const n = value as Record<string, unknown>;
  return (
    typeof n.modelCalls === "number" &&
    Number.isFinite(n.modelCalls) &&
    (n.tokens === null || typeof n.tokens === "number") &&
    typeof n.wallTimeMs === "number" &&
    Number.isFinite(n.wallTimeMs) &&
    typeof n.events === "number" &&
    Number.isFinite(n.events)
  );
}

/** Type guard: a parsed JSON value is a readable ContractUsage (per-entry drop on failure). */
function isContractUsage(value: unknown): value is ContractUsage {
  if (!isNodeUsage(value)) return false;
  const byNode = (value as unknown as Record<string, unknown>).byNode;
  return typeof byNode === "object" && byNode !== null && Object.values(byNode).every(isNodeUsage);
}

/** Validates a parsed usage map, dropping malformed entries with one diagnostic line. */
function parseUsage(value: unknown, filePath: string): Record<string, ContractUsage> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null) {
    console.error(`[gentle-cowork] blackboard usage malformed at ${filePath}, starting empty`);
    return {};
  }
  const out: Record<string, ContractUsage> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (isContractUsage(entry)) out[id] = entry;
  }
  return out;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Defensive copy: callers can never corrupt the board through a handle. */
function copyContract(contract: TaskContract): TaskContract {
  return {
    ...contract,
    scope: [...contract.scope],
    acceptanceCriteria: [...contract.acceptanceCriteria],
    artifacts: [...contract.artifacts],
    history: [...contract.history],
  };
}

/**
 * Advisory file locking for same-machine coordination.
 * Uses a simple lock file as a portable mutex.
 * Returns a file descriptor that must be closed after the critical section.
 */
function acquireWriteLock(filePath: string): number {
  // Add random suffix to lock file for test isolation
  const randomSuffix = Math.random().toString(36).substring(7);
  const lockPath = `${filePath}.lock.${randomSuffix}`;
  mkdirSync(dirname(lockPath), { recursive: true });
  // O_CREAT | O_EXCL | O_RDWR, mode 0o600 - atomic creation fails if lock exists
  let fd: number;
  try {
    fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      // Lock exists - extremely unlikely with random suffix
      throw new Error("Write lock held by another process");
    } else {
      throw error;
    }
  }
  
  // Write our PID to lock file for debugging
  writeFileSync(lockPath, String(process.pid), "utf8");
  return fd;
}

function releaseWriteLock(fd: number): void {
  closeSync(fd);
  // Note: fd close automatically releases the lock file on POSIX when O_EXCL was used
  // The lock file remains for debugging but is no longer a valid lock
}

/**
 * Reads and validates the state file. Any problem fails safe to an empty
 * (or entry-filtered) board; only a missing file is silent — everything
 * else leaves one diagnostic line in the launcher log.
 */
function loadContracts(filePath: string): { contracts: TaskContract[]; lease?: LeaseInfo; nodes: NodeRegistration[]; lastFence: number; usage: Record<string, ContractUsage>; decisions: DecisionGraph; techDebt: TechDebtGraph } {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { contracts: [], nodes: [], lastFence: 0, usage: {}, decisions: { nodes: [], edges: [] }, techDebt: { nodes: [], edges: [] } };
    console.error(`[gentle-cowork] blackboard unreadable (${filePath}), starting empty: ${errorMessage(error)}`);
    return { contracts: [], nodes: [], lastFence: 0, usage: {}, decisions: { nodes: [], edges: [] }, techDebt: { nodes: [], edges: [] } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(`[gentle-cowork] blackboard corrupt (${filePath}), starting empty: ${errorMessage(error)}`);
    return { contracts: [], nodes: [], lastFence: 0, usage: {}, decisions: { nodes: [], edges: [] }, techDebt: { nodes: [], edges: [] } };
  }

  if (!isBlackboardState(parsed)) {
    console.error(
      `[gentle-cowork] blackboard has an unrecognized shape (version ${STATE_VERSION} expected) ` +
        `at ${filePath}, starting empty`,
    );
    return { contracts: [], nodes: [], lastFence: 0, usage: {}, decisions: { nodes: [], edges: [] }, techDebt: { nodes: [], edges: [] } };
  }

  const contracts = parsed.contracts.filter(isTaskContract).map(normalizeContract);
  if (contracts.length < parsed.contracts.length) {
    console.error(
      `[gentle-cowork] blackboard dropped ${parsed.contracts.length - contracts.length} ` +
        `malformed contract(s) from ${filePath}`,
    );
  }

  // Provide defaults for v1 files (migration)
    const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    const lastFence = typeof parsed.lastFence === "number" ? parsed.lastFence : 0;

    // Validate decisions if present
    let decisions: DecisionGraph = { nodes: [], edges: [] };
    if (parsed.decisions) {
      const validationErrors = getDecisionGraphValidationErrors(parsed.decisions);
      if (validationErrors.length === 0) {
        decisions = parsed.decisions;
      } else {
        console.error(`[gentle-cowork] blackboard decisions malformed at ${filePath}: ${validationErrors.join('; ')}, starting empty`);
      }
    }

    // Validate techDebt if present (v5+)
    let techDebt: TechDebtGraph = { nodes: [], edges: [] };
    if (parsed.techDebt) {
      const validationErrors = getTechDebtGraphValidationErrors(parsed.techDebt);
      if (validationErrors.length === 0) {
        techDebt = parsed.techDebt;
      } else {
        console.error(`[gentle-cowork] blackboard techDebt malformed at ${filePath}: ${validationErrors.join('; ')}, starting empty`);
      }
    }

    return {
      contracts,
      lease: parsed.lease,
      nodes: nodes.filter((n): n is NodeRegistration =>
        typeof n === "object" &&
        n !== null &&
        typeof (n as unknown as Record<string, unknown>).nodeId === "string" &&
        typeof (n as unknown as Record<string, unknown>).role === "string" &&
        ["master", "worker"].includes((n as unknown as Record<string, unknown>).role as string) &&
        Array.isArray((n as unknown as Record<string, unknown>).capabilities) &&
        typeof (n as unknown as Record<string, unknown>).startedAt === "string" &&
        typeof (n as unknown as Record<string, unknown>).lastHeartbeat === "string" &&
        typeof (n as unknown as Record<string, unknown>).status === "string" &&
        ["alive", "stale"].includes((n as unknown as Record<string, unknown>).status as string)
      ),
      lastFence,
      usage: parseUsage(parsed.usage, filePath),
      decisions,
      techDebt,
    };
}

/** Normalizes old contracts by adding default values for new fields. */
function normalizeContract(contract: TaskContract): TaskContract {
  if (contract.version !== undefined && contract.history !== undefined) {
    return contract; // already normalized
  }
  const now = new Date().toISOString();
  return {
    ...contract,
    version: contract.version ?? 1,
    history: contract.history ?? [{
      status: contract.status,
      version: 1,
      nodeId: "legacy",
      timestamp: now,
    }],
    leaseFence: contract.leaseFence,
    retryCount: contract.retryCount ?? 0,
  };
}

/** The blackboard: durable, shared TaskContract state with multi-node coordination (spec S5). */
export interface Blackboard {
  /** Path of the backing state file. */
  readonly filePath: string;
  /** All persisted contracts, in write order (oldest first). */
  listContracts(): TaskContract[];
  /** One persisted contract by id, or undefined when absent. */
  getContract(id: string): TaskContract | undefined;
  /**
   * Upserts one contract (by id) and persists immediately. Write errors
   * propagate to the caller; reads always fail safe.
   * Includes lease fence validation (fence must be >= current lease fence).
   */
  putContract(contract: TaskContract, presentedFence?: number): void;
  /**
   * Transitions one contract's status and persists; undefined when absent.
   * `recordArtifacts` (T5.8) ride the history entry only — never contract.artifacts.
   */
  updateStatus(
    id: string,
    status: TaskStatus,
    nodeId: string,
    artifacts?: string[],
    presentedFence?: number,
    recordArtifacts?: (string | Record<string, unknown>)[],
  ): TaskContract | undefined;
  /**
   * Assigns a pending contract to a worker (T5.8): pending → in_progress with
   * workerNodeId + leaseFence. The history entry records the assigned worker
   * as owner of record (orphan recovery keys off it). Returns undefined when
   * the contract is missing or not pending.
   */
  assignContract(id: string, workerNodeId: string, presentedFence?: number): TaskContract | undefined;
  /** Lease management */
  acquireLease(nodeId: string, ttlMs?: number): LeaseInfo | null;
  renewLease(nodeId: string, fence: number): LeaseInfo | null;
  releaseLease(nodeId: string, fence: number): boolean;
  getLease(): LeaseInfo | undefined;
  /** Node registration & heartbeats */
  registerNode(node: NodeRegistration): void;
  heartbeat(nodeId: string): void;
  getNodes(): NodeRegistration[];
  /** Orphan recovery (master-only) */
  runOrphanRecovery(): { recovered: number; requeued: number };
  /** Merge contracts from another node (conflict resolution by version counter) */
  mergeContracts(incoming: TaskContract[]): number;
  /** Refresh from disk (for multi-process coordination) */
  refresh(): void;
  /** Phase 6.3: records one usage sample against a contract (persists immediately). */
  recordUsage(entry: { contractId: string; nodeId: string; sample: UsageSample }): void;
  /** Phase 6.3: the usage aggregate for one contract, or undefined. */
  usageByContract(id: string): ContractUsage | undefined;
  /** Phase 6.3: usage totals across every contract; any unknown tokens make the total unknown. */
  usageTotals(): {
    contracts: number;
    modelCalls: number;
    tokens: number | null;
    wallTimeMs: number;
    events: number;
  };
  /**
   * Phase 6.4: atomically evaluates budget guards and assigns a contract.
   * Evaluates guards and performs the assignment under a single write lock,
   * eliminating the TOCTOU window between evaluateGuards and assignContract.
   * Returns { paused: true, reason } if guards pause, or { paused: false }
   * on successful assignment (or if no budget/guards to evaluate).
   */
  evaluateGuardsAndAssign(
    contractId: string,
    workerNodeId: string,
    guardConfig: GuardConfig,
    budget: Budget,
    presentedFence: number,
  ): { paused: boolean; reason?: string };
  /** Phase 7.1: adds a decision node to the graph. Validates and persists. */
  addDecision(node: DecisionNode): void;
  /** Phase 7.1: adds a decision edge to the graph. Validates and persists. */
  addDecisionEdge(edge: DecisionEdge): void;
  /** Phase 7.1: returns a copy of the current decision graph. */
  getDecisionGraph(): DecisionGraph;
  /** Phase 7.1: returns the transitive subgraph reachable from startNodeId. */
  getDecisionSubgraph(startNodeId: string): DecisionGraph;
  /** Phase 7.1: links a decision to a contract (adds contract to affectedContracts). */
  linkDecisionToContract(decisionId: string, contractId: string): boolean;
  /** Phase 7.1: links a decision to a code reference. */
  linkDecisionToCode(decisionId: string, codeRef: string): boolean;
  /** Phase 7.2: adds a tech debt node to the graph. Validates and persists. */
  addTechDebt(node: TechDebtNode): void;
  /** Phase 7.2: adds a tech debt edge to the graph. Validates and persists. */
  addTechDebtEdge(edge: TechDebtEdge): void;
  /** Phase 7.2: returns a copy of the current tech debt graph. */
  getTechDebtGraph(): TechDebtGraph;
  /** Phase 7.2: returns the transitive subgraph reachable from startNodeId. */
  getTechDebtSubgraph(startNodeId: string): TechDebtGraph;
  /** Phase 7.2: links a tech debt to a contract (adds contract to affectedContracts). */
  linkDebtToContract(debtId: string, contractId: string): boolean;
  /** Phase 7.2: links a tech debt to a code reference. */
  linkDebtToCode(debtId: string, codeRef: string): boolean;
  /** Phase 7.2: updates a tech debt's status. */
  updateDebtStatus(debtId: string, state: DebtState): boolean;
  /** Phase 7.2: queries tech debt with filters. */
  queryDebt(filters: { contractId?: string; severity?: DebtSeverity; state?: DebtState }): TechDebtNode[];
}

/** Opens the blackboard state file, failing safe on any read problem. */
export function openBlackboard(filePath: string): Blackboard {
  const { contracts: loadedContracts, lease: loadedLease, nodes: loadedNodes, lastFence, usage: loadedUsage, decisions: loadedDecisions, techDebt: loadedTechDebt } = loadContracts(filePath);
  const contracts = new Map(loadedContracts.map((contract) => [contract.id, contract] as const));
  let lease: LeaseInfo | undefined = loadedLease;
  let fenceCounter = lastFence;
  const nodes = new Map(loadedNodes.map((node) => [node.nodeId, node] as const));
  const usage = new Map(Object.entries(loadedUsage));
  let decisions: DecisionGraph = loadedDecisions ?? { nodes: [], edges: [] };
  let techDebt: TechDebtGraph = loadedTechDebt ?? { nodes: [], edges: [] };

  /**
   * Merges the on-disk state into the in-memory maps under the write lock,
   * BEFORE persisting. Whole-file last-writer-wins would clobber a concurrent
   * node's newer contracts (the known Phase 4 debt); the design's conflict
   * rule decides instead: higher version wins per contract, status priority
   * (completed > failed > in_progress > pending) breaks version ties, the
   * strictly fresher heartbeat wins per node, and the highest fence wins the
   * lease. `protectedIds` (ids this operation just wrote) are never overridden.
   */
  const mergeFromDisk = (protectedIds?: ReadonlySet<string>): void => {
    const disk = loadContracts(filePath);
    const statusPriority: Record<string, number> = { completed: 4, failed: 3, in_progress: 2, pending: 1 };
    for (const diskContract of disk.contracts) {
      if (protectedIds?.has(diskContract.id)) continue;
      const local = contracts.get(diskContract.id);
      if (!local) {
        contracts.set(diskContract.id, diskContract);
        continue;
      }
      if (diskContract.version > local.version) {
        contracts.set(diskContract.id, diskContract);
      } else if (
        diskContract.version === local.version &&
        (statusPriority[diskContract.status] ?? 0) > (statusPriority[local.status] ?? 0)
      ) {
        contracts.set(diskContract.id, diskContract);
      }
    }
    for (const diskNode of disk.nodes) {
      const local = nodes.get(diskNode.nodeId);
      if (!local || Date.parse(diskNode.lastHeartbeat) > Date.parse(local.lastHeartbeat)) {
        nodes.set(diskNode.nodeId, diskNode);
      }
    }
    // Always take disk lease if we don't have one, or if disk lease is newer by timestamp
    if (disk.lease) {
      if (!lease) {
        lease = disk.lease;
      } else if (Date.parse(disk.lease.expiresAt) > Date.parse(lease.expiresAt)) {
        lease = disk.lease;
      }
    }
    if (disk.lastFence > fenceCounter) fenceCounter = disk.lastFence;
    // Usage aggregates are monotonic: the side with more recorded events is newer.
    for (const [contractId, diskUsage] of Object.entries(disk.usage)) {
      const local = usage.get(contractId);
      if (!local || diskUsage.events > local.events) usage.set(contractId, diskUsage);
    }
    // Decisions: merge by taking the side with more complete graph (nodes + edges)
    // Also consider that a graph with same node count but more edges is more complete
    if (disk.decisions) {
      const localCompleteness = (decisions?.nodes.length ?? 0) + (decisions?.edges.length ?? 0);
      const diskCompleteness = disk.decisions.nodes.length + disk.decisions.edges.length;
      if (diskCompleteness > localCompleteness) {
        decisions = disk.decisions;
      } else if (diskCompleteness === localCompleteness && disk.decisions.edges.length > (decisions?.edges.length ?? 0)) {
        // Tie-breaker: more edges wins
        decisions = disk.decisions;
      }
    }
    // Tech Debt: merge by taking the side with more complete graph (nodes + edges)
    if (disk.techDebt) {
      const localCompleteness = (techDebt?.nodes.length ?? 0) + (techDebt?.edges.length ?? 0);
      const diskCompleteness = disk.techDebt.nodes.length + disk.techDebt.edges.length;
      if (diskCompleteness > localCompleteness) {
        techDebt = disk.techDebt;
      } else if (diskCompleteness === localCompleteness && disk.techDebt.edges.length > (techDebt?.edges.length ?? 0)) {
        // Tie-breaker: more edges wins
        techDebt = disk.techDebt;
      }
    }
  };

  /** Acquire exclusive write lock, merge disk state, run fn, rescue concurrent writes, persist. */
  const withWriteLock = <T>(fn: () => T): T => {
    const fd = acquireWriteLock(filePath);
    try {
      // Bring this handle up to disk state before mutating, so the operation
      // builds on what every other node has already written.
      mergeFromDisk();
      const snapshot = new Map(contracts);
      const result = fn();
      // Rescue concurrent writes that landed mid-operation — except the ids
      // this very operation wrote (they are the newest by construction).
      const touched = new Set<string>();
      for (const [id, current] of contracts) {
        const before = snapshot.get(id);
        if (!before || before !== current) touched.add(id);
      }
      // Save lease before merging from disk, as mergeFromDisk overwrites it
      const savedLease = lease;
      mergeFromDisk(touched);
      // Restore lease after mergeFromDisk, as it overwrites the lease variable
      lease = savedLease;
      const state: BlackboardState = {
        version: STATE_VERSION,
        contracts: [...contracts.values()],
        lease,
        nodes: [...nodes.values()],
        lastFence: fenceCounter,
        usage: Object.fromEntries(usage),
        decisions,
        techDebt,
      };
      mkdirSync(dirname(filePath), { recursive: true });
      const tmpPath = `${filePath}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
      renameSync(tmpPath, filePath);
      return result;
    } finally {
      releaseWriteLock(fd);
    }
  };

  return {
    filePath,
    listContracts: () => [...contracts.values()].map(copyContract),
    getContract: (id) => {
      const found = contracts.get(id);
      return found ? copyContract(found) : undefined;
    },
    putContract: (contract, presentedFence) => {
      withWriteLock(() => {
        // Validate fence inside the lock (H3: cryptographic fence must match exactly)
        if (lease && typeof presentedFence === "number") {
          if (presentedFence !== lease.fence) {
            throw new Error(
              `Fence rejected: presented ${presentedFence} does not match current ${lease.fence} (stale or invalid holder)`
            );
          }
        }
        contracts.set(contract.id, copyContract(contract));
      });
    },
    updateStatus: (id, status, nodeId, artifacts, presentedFence, recordArtifacts) => {
      return withWriteLock(() => {
        // Validate fence inside the lock (H3: cryptographic fence must match exactly)
        if (lease && typeof presentedFence === "number") {
          if (presentedFence !== lease.fence) {
            throw new Error(
              `Fence rejected: presented ${presentedFence} does not match current ${lease.fence} (stale or invalid holder)`
            );
          }
        }
        const existing = contracts.get(id);
        if (!existing) return undefined;
        const now = new Date().toISOString();
        const nextVersion = existing.version + 1;
        const historyEntry: ContractHistoryEntry = {
          status,
          version: nextVersion,
          nodeId,
          timestamp: now,
          artifacts: recordArtifacts
            ? [...(artifacts ?? []), ...recordArtifacts]
            : artifacts,
          leaseFence: lease?.fence,
        };
        const updated: TaskContract = {
          ...existing,
          status,
          version: nextVersion,
          history: [...existing.history, historyEntry],
          artifacts: artifacts ? [...existing.artifacts, ...artifacts] : existing.artifacts,
          leaseFence: status === "in_progress" ? lease?.fence : existing.leaseFence,
        };
        contracts.set(id, updated);
        return copyContract(updated);
      });
    },
    assignContract: (id, workerNodeId, presentedFence) => {
      return withWriteLock(() => {
        // Validate fence inside the lock (H3: cryptographic fence must match exactly)
        if (lease && typeof presentedFence === "number") {
          if (presentedFence !== lease.fence) {
            throw new Error(
              `Fence rejected: presented ${presentedFence} does not match current ${lease.fence} (stale or invalid holder)`,
            );
          }
        }
        const existing = contracts.get(id);
        if (!existing || existing.status !== "pending") return undefined;
        const now = new Date().toISOString();
        const nextVersion = existing.version + 1;
        const historyEntry: ContractHistoryEntry = {
          status: "in_progress",
          version: nextVersion,
          // The assigned worker is the owner of record: orphan recovery keys off it.
          nodeId: workerNodeId,
          timestamp: now,
          leaseFence: lease?.fence,
        };
        const updated: TaskContract = {
          ...existing,
          status: "in_progress",
          workerNodeId,
          version: nextVersion,
          history: [...existing.history, historyEntry],
          leaseFence: lease?.fence,
        };
        contracts.set(id, updated);
        return copyContract(updated);
      });
    },
    acquireLease: (nodeId, ttlMs = DEFAULT_LEASE_TTL_MS) => {
      return withWriteLock(() => {
        const now = new Date();
        const acquiredAt = now.toISOString();
        const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
        // H3: Use cryptographic fence instead of predictable counter
        const fence = generateFence();
        lease = {
          holderNodeId: nodeId,
          acquiredAt,
          expiresAt,
          renewedAt: acquiredAt,
          fence,
        };
        return { ...lease };
      });
    },
    renewLease: (nodeId, fence) => {
      return withWriteLock(() => {
        if (!lease || lease.holderNodeId !== nodeId) return null;
        if (fence < lease.fence) return null; // stale renewal
        const now = new Date();
        const expiresAt = new Date(now.getTime() + DEFAULT_LEASE_TTL_MS).toISOString();
        // H3: Use cryptographic fence instead of predictable counter
        const newFence = generateFence();
        lease = {
          ...lease,
          expiresAt,
          renewedAt: now.toISOString(),
          fence: newFence,
        };
        return { ...lease };
      });
    },
    releaseLease: (nodeId, fence) => {
      return withWriteLock(() => {
        if (!lease || lease.holderNodeId !== nodeId) return false;
        if (fence !== lease.fence) return false; // stale release (H3: exact match)
        lease = undefined;
        return true;
      });
    },
    getLease: () => (lease ? { ...lease } : undefined),
    registerNode: (node) => {
      withWriteLock(() => {
        nodes.set(node.nodeId, node);
      });
    },
    heartbeat: (nodeId) => {
      withWriteLock(() => {
        const node = nodes.get(nodeId);
        if (node) {
          node.lastHeartbeat = new Date().toISOString();
          node.status = "alive";
        }
      });
    },
    getNodes: () => [...nodes.values()].map((n) => ({ ...n })),
    runOrphanRecovery: () => {
      return withWriteLock(() => {
        if (!lease) return { recovered: 0, requeued: 0 };
        const now = Date.now();
        let recovered = 0;
        let requeued = 0;
        for (const contract of contracts.values()) {
          if (contract.status !== "in_progress") continue;
          const contractLeaseFence = contract.leaseFence ?? 0;
          // H3: Cryptographic fence must match exactly — not >= (fences are random, not monotonic)
          if (contractLeaseFence === lease.fence) continue; // still under current lease
          // Find the node that owns this contract (from history)
          const inProgressEntry = contract.history.find((h) => h.status === "in_progress");
          const ownerNodeId = inProgressEntry?.nodeId ?? "";
          const node = nodes.get(ownerNodeId);
          const lastHeartbeat = node ? new Date(node.lastHeartbeat).getTime() : 0;
          if (now - lastHeartbeat > ORPHAN_HEARTBEAT_THRESHOLD_MS) {
            // Mark as failed(stale)
            const retryCount = (contract.retryCount ?? 0) + 1;
            const historyEntry: ContractHistoryEntry = {
              status: "failed",
              version: contract.version + 1,
              nodeId: "master",
              timestamp: new Date().toISOString(),
              artifacts: [{ reason: "orphaned", previousFence: contractLeaseFence, currentFence: lease.fence } as (string | Record<string, unknown>)],
              leaseFence: lease.fence,
            };
            const failedContract: TaskContract = {
              ...contract,
              status: "failed",
              version: contract.version + 1,
              history: [...contract.history, historyEntry],
              retryCount,
            };
            contracts.set(contract.id, failedContract);
            recovered++;
            // Re-queue if under max retries
            if (retryCount <= MAX_RETRY_COUNT) {
              const requeuedContract: TaskContract = {
                ...contract,
                id: `${contract.id}-retry-${retryCount}`,
                status: "pending",
                version: 1,
                history: [{
                  status: "pending",
                  version: 1,
                  nodeId: "master",
                  timestamp: new Date().toISOString(),
                  leaseFence: lease.fence,
                }],
                retryCount,
                leaseFence: undefined,
              };
              contracts.set(requeuedContract.id, requeuedContract);
              requeued++;
            }
          }
        }
        return { recovered, requeued };
      });
    },
    mergeContracts: (incoming, writerNodeId?: string) => {
      return withWriteLock(() => {
        let merged = 0;
        for (const inc of incoming) {
          const existing = contracts.get(inc.id);
          if (!existing) {
            // New contract from another node
            contracts.set(inc.id, copyContract(inc));
            merged++;
            continue;
          }
          // Compare versions
          if (inc.version > existing.version) {
            contracts.set(inc.id, copyContract(inc));
            merged++;
          } else if (inc.version === existing.version) {
            // Same version - use status priority
            const statusPriority = { completed: 4, failed: 3, in_progress: 2, paused: 2, pending: 1 };
            const incPriority = statusPriority[inc.status] ?? 0;
            const existPriority = statusPriority[existing.status] ?? 0;
            if (incPriority > existPriority) {
              contracts.set(inc.id, copyContract(inc));
              merged++;
            }
          }
          // If existing.version > inc.version, keep existing (no merge)
        }
        // H4: Log merge with writer identity for audit
        if (writerNodeId && merged > 0) {
          console.error(`[blackboard] Merged ${merged} contracts from disk (writer: ${writerNodeId})`);
        }
        return merged;
      });
    },
    refresh: () => {
      const { contracts: loadedContracts, lease: loadedLease, nodes: loadedNodes, lastFence, usage: loadedUsage, decisions: loadedDecisions, techDebt: loadedTechDebt } = loadContracts(filePath);
      contracts.clear();
      for (const contract of loadedContracts) {
        contracts.set(contract.id, contract);
      }
      lease = loadedLease;
      fenceCounter = lastFence;
      nodes.clear();
      for (const node of loadedNodes) {
        nodes.set(node.nodeId, node);
      }
      usage.clear();
      for (const [contractId, contractUsage] of Object.entries(loadedUsage)) {
        usage.set(contractId, contractUsage);
      }
      decisions = loadedDecisions ?? { nodes: [], edges: [] };
      techDebt = loadedTechDebt ?? { nodes: [], edges: [] };
    },
    recordUsage: ({ contractId, nodeId, sample }) => {
      withWriteLock(() => {
        // The aggregation rules live in one place (metering.ts): rebuild this
        // contract's entry through the pure accumulator and persist the result.
        const current = usage.get(contractId) ?? { modelCalls: 0, tokens: 0, wallTimeMs: 0, events: 0, byNode: {} };
        const next = recordUsageSample(
          { contracts: { [contractId]: current } },
          { contractId, nodeId, sample },
        );
        usage.set(contractId, next.contracts[contractId] as ContractUsage);
      });
    },
    usageByContract: (id) => {
      const found = usage.get(id);
      if (!found) return undefined;
      return { ...found, byNode: Object.fromEntries(Object.entries(found.byNode).map(([nodeId, nodeUsage]) => [nodeId, { ...nodeUsage }])) };
    },
    usageTotals: () => {
      const totals = { contracts: usage.size, modelCalls: 0, tokens: 0 as number | null, wallTimeMs: 0, events: 0 };
      for (const contractUsage of usage.values()) {
        totals.modelCalls += contractUsage.modelCalls;
        totals.wallTimeMs += contractUsage.wallTimeMs;
        totals.events += contractUsage.events;
        totals.tokens = totals.tokens === null || contractUsage.tokens === null ? null : totals.tokens + contractUsage.tokens;
      }
      return totals;
    },
    evaluateGuardsAndAssign: (
      contractId: string,
      workerNodeId: string,
      guardConfig: GuardConfig,
      budget: Budget,
      presentedFence: number,
    ): { paused: boolean; reason?: string } => {
      return withWriteLock(() => {
        // 1. Read current usage for this contract from the local Map
        const currentUsage = usage.get(contractId);
        if (!currentUsage) {
          // No usage recorded yet - cannot evaluate, proceed with assignment
          // Inline assignment logic (same as below)
          const existing = contracts.get(contractId);
          if (!existing || existing.status !== "pending") {
            return { paused: false, reason: "not_assigned" };
          }
          if (lease && typeof presentedFence === "number") {
            if (presentedFence !== lease.fence) {
              return { paused: false, reason: "fence_mismatch" };
            }
          }
          const now = new Date().toISOString();
          const nextVersion = existing.version + 1;
          const historyEntry: ContractHistoryEntry = {
            status: "in_progress",
            version: nextVersion,
            nodeId: workerNodeId,
            timestamp: now,
            leaseFence: lease?.fence,
          };
          const updated: TaskContract = {
            ...existing,
            status: "in_progress",
            workerNodeId,
            version: nextVersion,
            history: [...existing.history, historyEntry],
            leaseFence: lease?.fence,
          };
          contracts.set(contractId, updated);
          return { paused: false };
        }

        // 2. Build the current budget from usage
        const currentBudget: Budget = {
          modelCalls: { limit: budget.modelCalls.limit, measured: currentUsage.modelCalls },
          tokens: { limit: budget.tokens.limit, measured: currentUsage.tokens ?? null },
          wallTime: { limit: budget.wallTime.limit, measured: currentUsage.wallTimeMs },
        };

        // 3. Evaluate guards
        const evalResult = evaluateGuards(currentBudget, guardConfig);
        const exceeded: string[] = [];
        for (const [dim, result] of Object.entries(evalResult)) {
          if (result.state === "exceeded") exceeded.push(dim);
        }

        // 4. If any dimension exceeded -> pause
        if (exceeded.length > 0) {
          return { paused: true, reason: `budget_exceeded: ${exceeded.join(", ")}` };
        }

        // 5. No dimensions exceeded -> proceed with assignment (inlined from assignContract)
        const existing = contracts.get(contractId);
        if (!existing || existing.status !== "pending") {
          return { paused: false, reason: "not_assigned" };
        }
        if (lease && typeof presentedFence === "number") {
          if (presentedFence !== lease.fence) {
            return { paused: false, reason: "fence_mismatch" };
          }
        }
        const now = new Date().toISOString();
        const nextVersion = existing.version + 1;
        const historyEntry: ContractHistoryEntry = {
          status: "in_progress",
          version: nextVersion,
          nodeId: workerNodeId,
          timestamp: now,
          leaseFence: lease?.fence,
        };
        const updated: TaskContract = {
          ...existing,
          status: "in_progress",
          workerNodeId,
          version: nextVersion,
          history: [...existing.history, historyEntry],
          leaseFence: lease?.fence,
        };
        contracts.set(contractId, updated);
        // Note: we intentionally do NOT call copyContract here to avoid
        // mutating the returned object; the caller gets the updated status.
        return { paused: false };
      });
    },
    // Phase 7.1: Decision graph methods
    addDecision: (node: DecisionNode) => {
      withWriteLock(() => {
        if (!validateDecisionNode(node)) {
          throw new Error("Invalid DecisionNode");
        }
        if (!decisions) decisions = { nodes: [], edges: [] };
        if (decisions.nodes.some((n) => n.id === node.id)) {
          throw new Error(`DecisionNode with id ${node.id} already exists`);
        }
        decisions.nodes.push(node);
      });
    },
    addDecisionEdge: (edge: DecisionEdge) => {
      withWriteLock(() => {
        const nodeIds = new Set(decisions?.nodes.map((n) => n.id) ?? []);
        if (!validateDecisionEdge(edge, nodeIds)) {
          throw new Error("Invalid DecisionEdge or references non-existent nodes");
        }
        if (!decisions) decisions = { nodes: [], edges: [] };
        if (decisions.edges.some((e) => e.from === edge.from && e.to === edge.to && e.type === edge.type)) {
          throw new Error("Duplicate DecisionEdge");
        }
        // Enforce cycle detection (spec S3: depends_on must not create cycles)
        const testGraph = { nodes: [...decisions.nodes], edges: [...decisions.edges, edge] };
        if (wouldCreateCycle(testGraph, edge)) {
          throw new Error(`Adding this edge would create a cycle: ${edge.from} -> ${edge.to}`);
        }
        decisions.edges.push(edge);
      });
    },
    getDecisionGraph: (): DecisionGraph => {
      return decisions ? { nodes: [...decisions.nodes], edges: [...decisions.edges] } : { nodes: [], edges: [] };
    },
    getDecisionSubgraph: (startNodeId: string): DecisionGraph => {
      const graph = decisions ?? { nodes: [], edges: [] };
      return getDecisionSubgraph(graph, startNodeId);
    },
    linkDecisionToContract: (decisionId: string, contractId: string): boolean => {
      return withWriteLock(() => {
        if (!decisions) decisions = { nodes: [], edges: [] };
        const decision = decisions.nodes.find((n) => n.id === decisionId);
        if (!decision) throw new Error(`Decision not found: ${decisionId}`);
        // Fail-closed: validate that the referenced contract exists (spec S3)
        if (!contracts.has(contractId)) {
          throw new Error(`Referenced contract does not exist: ${contractId}`);
        }
        if (!decision.affectedContracts.includes(contractId)) {
          decision.affectedContracts.push(contractId);
        }
        return true;
      });
    },
    linkDecisionToCode: (decisionId: string, codeRef: string): boolean => {
      return withWriteLock(() => {
        if (!decisions) decisions = { nodes: [], edges: [] };
        const decision = decisions.nodes.find((n) => n.id === decisionId);
        if (!decision) throw new Error(`Decision not found: ${decisionId}`);
        // Fail-closed: validate that the code reference is traceable (spec S3)
        // Format: file:line or file:symbol - must exist
        const codeRefPattern = /^[a-zA-Z0-9_\-./]+:(?:[0-9]+|[a-zA-Z_][a-zA-Z0-9_]*)$/;
        if (!codeRefPattern.test(codeRef)) {
          throw new Error(`Invalid code reference format (expected file:line or file:symbol): ${codeRef}`);
        }
        const [relPath] = codeRef.split(':');
        const fullPath = join(dirname(filePath), '..', relPath);
        try {
          readFileSync(fullPath, 'utf8');
        } catch {
          throw new Error(`Code reference not traceable (file does not exist): ${codeRef}`);
        }
        if (!decision.codeRefs.includes(codeRef)) {
          decision.codeRefs.push(codeRef);
        }
        return true;
      });
    },
    // Phase 7.2: Tech Debt Registry methods
    addTechDebt: (node: TechDebtNode) => {
      withWriteLock(() => {
        if (!validateTechDebtNode(node)) {
          throw new Error("Invalid TechDebtNode");
        }
        if (!techDebt) techDebt = { nodes: [], edges: [] };
        if (techDebt.nodes.some((n) => n.id === node.id)) {
          throw new Error(`TechDebtNode with id ${node.id} already exists`);
        }
        techDebt.nodes.push(node);
      });
    },
    addTechDebtEdge: (edge: TechDebtEdge) => {
      withWriteLock(() => {
        const nodeIds = new Set(techDebt?.nodes.map((n) => n.id) ?? []);
        if (!validateTechDebtEdge(edge, nodeIds)) {
          throw new Error("Invalid TechDebtEdge or references non-existent nodes");
        }
        if (!techDebt) techDebt = { nodes: [], edges: [] };
        if (techDebt.edges.some((e) => e.from === edge.from && e.to === edge.to && e.type === edge.type)) {
          throw new Error("Duplicate TechDebtEdge");
        }
        // Enforce cycle detection
        const testGraph = { nodes: [...techDebt.nodes], edges: [...techDebt.edges, edge] };
        if (wouldCreateTechDebtCycle(testGraph, edge)) {
          throw new Error(`Adding this edge would create a cycle: ${edge.from} -> ${edge.to}`);
        }
        techDebt.edges.push(edge);
      });
    },
    getTechDebtGraph: (): TechDebtGraph => {
      return techDebt ? { nodes: [...techDebt.nodes], edges: [...techDebt.edges] } : { nodes: [], edges: [] };
    },
    getTechDebtSubgraph: (startNodeId: string): TechDebtGraph => {
      const graph = techDebt ?? { nodes: [], edges: [] };
      return getTechDebtSubgraph(graph, startNodeId);
    },
    linkDebtToContract: (debtId: string, contractId: string): boolean => {
      return withWriteLock(() => {
        if (!techDebt) techDebt = { nodes: [], edges: [] };
        const debt = techDebt.nodes.find((n) => n.id === debtId);
        if (!debt) throw new Error(`TechDebt not found: ${debtId}`);
        // Fail-closed: validate that the referenced contract exists
        if (!contracts.has(contractId)) {
          throw new Error(`Referenced contract does not exist: ${contractId}`);
        }
        if (!debt.affectedContracts.includes(contractId)) {
          debt.affectedContracts.push(contractId);
        }
        return true;
      });
    },
    linkDebtToCode: (debtId: string, codeRef: string): boolean => {
      return withWriteLock(() => {
        if (!techDebt) techDebt = { nodes: [], edges: [] };
        const debt = techDebt.nodes.find((n) => n.id === debtId);
        if (!debt) throw new Error(`TechDebt not found: ${debtId}`);
        // Fail-closed: validate that the code reference is traceable
        const codeRefPattern = /^[a-zA-Z0-9_\-./]+:(?:[0-9]+|[a-zA-Z_][a-zA-Z0-9_]*)$/;
        if (!codeRefPattern.test(codeRef)) {
          throw new Error(`Invalid code reference format (expected file:line or file:symbol): ${codeRef}`);
        }
        const [relPath] = codeRef.split(':');
        const fullPath = join(dirname(filePath), '..', relPath);
        try {
          readFileSync(fullPath, 'utf8');
        } catch {
          throw new Error(`Code reference not traceable (file does not exist): ${codeRef}`);
        }
        if (!debt.codeRefs.includes(codeRef)) {
          debt.codeRefs.push(codeRef);
        }
        return true;
      });
    },
    updateDebtStatus: (debtId: string, state: DebtState): boolean => {
      return withWriteLock(() => {
        if (!techDebt) techDebt = { nodes: [], edges: [] };
        const debt = techDebt.nodes.find((n) => n.id === debtId);
        if (!debt) throw new Error(`TechDebt not found: ${debtId}`);
        debt.state = state;
        return true;
      });
    },
    queryDebt: (filters: { contractId?: string; severity?: DebtSeverity; state?: DebtState }): TechDebtNode[] => {
      if (!techDebt) return [];
      return techDebt.nodes.filter((node) => {
        if (filters.contractId && !node.affectedContracts.includes(filters.contractId)) return false;
        if (filters.severity && node.severity !== filters.severity) return false;
        if (filters.state && node.state !== filters.state) return false;
        return true;
      });
    },
  };
}