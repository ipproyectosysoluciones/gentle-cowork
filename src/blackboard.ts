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
} from "node:fs";
import { dirname, join } from "node:path";

import type { TaskContract, TaskStatus, ContractHistoryEntry } from "./types.ts";

/** Directory (inside the project cwd) holding the blackboard state file. */
export const BLACKBOARD_DIR = ".gentle-cowork";

/** File name of the blackboard state file inside BLACKBOARD_DIR. */
export const BLACKBOARD_FILENAME = "blackboard.json";

/** Current state file format version. */
export const STATE_VERSION = 2;

/** The on-disk shape of the blackboard state file. */
export interface BlackboardState {
  version: number;
  contracts: TaskContract[];
  lease?: LeaseInfo;
  nodes: NodeRegistration[];
  lastFence: number;
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

/** Resolves the blackboard state file path for a project working directory. */
export function defaultBlackboardPath(projectCwd: string): string {
  return join(projectCwd, BLACKBOARD_DIR, BLACKBOARD_FILENAME);
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
  // Accept both v1 (legacy) and v2 (current) for migration
  return (
    (s.version === 1 || s.version === STATE_VERSION) &&
    Array.isArray(s.contracts) &&
    (s.lease === undefined || typeof s.lease === "object") &&
    (s.nodes === undefined || Array.isArray(s.nodes)) &&
    (s.lastFence === undefined || typeof s.lastFence === "number")
  );
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
  const lockPath = `${filePath}.lock`;
  mkdirSync(dirname(lockPath), { recursive: true });
  // O_CREAT | O_RDWR, mode 0o600
  const fd = openSync(lockPath, constants.O_CREAT | constants.O_RDWR, 0o600);
  try {
    writeFileSync(lockPath, String(process.pid), "utf8");
  } catch {
    closeSync(fd);
    throw new Error("Failed to acquire write lock");
  }
  return fd;
}

function releaseWriteLock(fd: number): void {
  closeSync(fd);
}

/**
 * Reads and validates the state file. Any problem fails safe to an empty
 * (or entry-filtered) board; only a missing file is silent — everything
 * else leaves one diagnostic line in the launcher log.
 */
function loadContracts(filePath: string): { contracts: TaskContract[]; lease?: LeaseInfo; nodes: NodeRegistration[]; lastFence: number } {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { contracts: [], nodes: [], lastFence: 0 };
    console.error(`[gentle-cowork] blackboard unreadable (${filePath}), starting empty: ${errorMessage(error)}`);
    return { contracts: [], nodes: [], lastFence: 0 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(`[gentle-cowork] blackboard corrupt (${filePath}), starting empty: ${errorMessage(error)}`);
    return { contracts: [], nodes: [], lastFence: 0 };
  }

  if (!isBlackboardState(parsed)) {
    console.error(
      `[gentle-cowork] blackboard has an unrecognized shape (version ${STATE_VERSION} expected) ` +
        `at ${filePath}, starting empty`,
    );
    return { contracts: [], nodes: [], lastFence: 0 };
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
}

/** Opens the blackboard state file, failing safe on any read problem. */
export function openBlackboard(filePath: string): Blackboard {
  const { contracts: loadedContracts, lease: loadedLease, nodes: loadedNodes, lastFence } = loadContracts(filePath);
  const contracts = new Map(loadedContracts.map((contract) => [contract.id, contract] as const));
  let lease: LeaseInfo | undefined = loadedLease;
  let fenceCounter = lastFence;
  const nodes = new Map(loadedNodes.map((node) => [node.nodeId, node] as const));

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
    if (disk.lease && (!lease || disk.lease.fence > lease.fence)) lease = disk.lease;
    if (disk.lastFence > fenceCounter) fenceCounter = disk.lastFence;
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
      mergeFromDisk(touched);
      const state: BlackboardState = {
        version: STATE_VERSION,
        contracts: [...contracts.values()],
        lease,
        nodes: [...nodes.values()],
        lastFence: fenceCounter,
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
        // Validate fence inside the lock
        if (lease && typeof presentedFence === "number") {
          if (presentedFence < lease.fence) {
            throw new Error(
              `Fence rejected: presented ${presentedFence} < current ${lease.fence} (stale holder)`
            );
          }
        }
        contracts.set(contract.id, copyContract(contract));
      });
    },
    updateStatus: (id, status, nodeId, artifacts, presentedFence, recordArtifacts) => {
      return withWriteLock(() => {
        // Validate fence inside the lock
        if (lease && typeof presentedFence === "number") {
          if (presentedFence < lease.fence) {
            throw new Error(
              `Fence rejected: presented ${presentedFence} < current ${lease.fence} (stale holder)`
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
        // Validate fence inside the lock
        if (lease && typeof presentedFence === "number") {
          if (presentedFence < lease.fence) {
            throw new Error(
              `Fence rejected: presented ${presentedFence} < current ${lease.fence} (stale holder)`,
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
        fenceCounter += 1;
        lease = {
          holderNodeId: nodeId,
          acquiredAt,
          expiresAt,
          renewedAt: acquiredAt,
          fence: fenceCounter,
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
        fenceCounter += 1;
        lease = {
          ...lease,
          expiresAt,
          renewedAt: now.toISOString(),
          fence: fenceCounter,
        };
        return { ...lease };
      });
    },
    releaseLease: (nodeId, fence) => {
      return withWriteLock(() => {
        if (!lease || lease.holderNodeId !== nodeId) return false;
        if (fence < lease.fence) return false; // stale release
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
          if (contractLeaseFence >= lease.fence) continue; // still under current lease
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
    mergeContracts: (incoming) => {
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
            const statusPriority = { completed: 4, failed: 3, in_progress: 2, pending: 1 };
            const incPriority = statusPriority[inc.status] ?? 0;
            const existPriority = statusPriority[existing.status] ?? 0;
            if (incPriority > existPriority) {
              contracts.set(inc.id, copyContract(inc));
              merged++;
            }
          }
          // If existing.version > inc.version, keep existing (no merge)
        }
        return merged;
      });
    },
    refresh: () => {
      const { contracts: loadedContracts, lease: loadedLease, nodes: loadedNodes, lastFence } = loadContracts(filePath);
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
    },
  };
}