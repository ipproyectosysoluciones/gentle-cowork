/**
 * gentle-cowork — Phase 4: blackboard state persistence.
 *
 * A shared state file (JSON) that all roles read/write (ROADMAP Phase 4 /
 * spec S5): every TaskContract the extension issues — through any role —
 * is persisted to `<project-cwd>/.gentle-cowork/blackboard.json`, so
 * contract state survives daemon restarts. The board keeps the full
 * pending → in_progress → completed/failed lifecycle on disk.
 *
 * Reads fail safe: a missing, corrupt, or unrecognized state file yields
 * an empty board, never a crash. Writes are atomic (temp file + rename),
 * so a daemon killed mid-write can never leave a half-written board
 * behind. In Phase 4 the extension performs the reads and writes on
 * behalf of every role; the file is the shared substrate that later
 * phases (multi-node scaling) can read and write directly.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { TaskContract, TaskStatus } from "./types.ts";

/** Directory (inside the project cwd) holding the blackboard state file. */
export const BLACKBOARD_DIR = ".gentle-cowork";

/** File name of the blackboard state file inside BLACKBOARD_DIR. */
export const BLACKBOARD_FILENAME = "blackboard.json";

/** Current state file format version. */
const STATE_VERSION = 1;

/** The on-disk shape of the blackboard state file. */
export interface BlackboardState {
  version: number;
  contracts: TaskContract[];
}

/** Resolves the blackboard state file path for a project working directory. */
export function defaultBlackboardPath(projectCwd: string): string {
  return join(projectCwd, BLACKBOARD_DIR, BLACKBOARD_FILENAME);
}

const TASK_STATUSES: ReadonlySet<string> = new Set(["pending", "in_progress", "completed", "failed"]);
const COWORK_ROLES: ReadonlySet<string> = new Set(["planner", "implementer", "verifier"]);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Type guard: a plain JSON value is a well-formed TaskContract. */
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

/** Type guard: a parsed JSON value is a readable blackboard state file. */
function isBlackboardState(value: unknown): value is BlackboardState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return s.version === STATE_VERSION && Array.isArray(s.contracts);
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
  };
}

/**
 * Reads and validates the state file. Any problem fails safe to an empty
 * (or entry-filtered) board; only a missing file is silent — everything
 * else leaves one diagnostic line in the launcher log.
 */
function loadContracts(filePath: string): TaskContract[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    console.error(`[gentle-cowork] blackboard unreadable (${filePath}), starting empty: ${errorMessage(error)}`);
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(`[gentle-cowork] blackboard corrupt (${filePath}), starting empty: ${errorMessage(error)}`);
    return [];
  }

  if (!isBlackboardState(parsed)) {
    console.error(
      `[gentle-cowork] blackboard has an unrecognized shape (version ${STATE_VERSION} expected) ` +
        `at ${filePath}, starting empty`,
    );
    return [];
  }

  const contracts = parsed.contracts.filter(isTaskContract);
  if (contracts.length < parsed.contracts.length) {
    console.error(
      `[gentle-cowork] blackboard dropped ${parsed.contracts.length - contracts.length} ` +
        `malformed contract(s) from ${filePath}`,
    );
  }
  return contracts;
}

/** The blackboard: durable, shared TaskContract state (spec S5). */
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
   */
  putContract(contract: TaskContract): void;
  /** Transitions one contract's status and persists; undefined when absent. */
  updateStatus(id: string, status: TaskStatus): TaskContract | undefined;
}

/** Opens the blackboard state file, failing safe on any read problem. */
export function openBlackboard(filePath: string): Blackboard {
  const contracts = new Map(loadContracts(filePath).map((contract) => [contract.id, contract] as const));

  /** Writes the whole board atomically: temp file, then rename. */
  const persist = (): void => {
    const state: BlackboardState = { version: STATE_VERSION, contracts: [...contracts.values()] };
    mkdirSync(dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
    renameSync(tmpPath, filePath);
  };

  return {
    filePath,
    listContracts: () => [...contracts.values()].map(copyContract),
    getContract: (id) => {
      const found = contracts.get(id);
      return found ? copyContract(found) : undefined;
    },
    putContract: (contract) => {
      contracts.set(contract.id, copyContract(contract));
      persist();
    },
    updateStatus: (id, status) => {
      const existing = contracts.get(id);
      if (!existing) return undefined;
      const updated: TaskContract = { ...existing, status };
      contracts.set(id, updated);
      persist();
      return copyContract(updated);
    },
  };
}
