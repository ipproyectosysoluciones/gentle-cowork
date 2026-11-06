/**
 * The contract store (slice 6.1): one versioned file per project at
 * `<project-cwd>/.gentle-cowork/contract.json` — a sibling of the blackboard
 * state file, written with the same discipline: atomic writes (temp file +
 * rename, mode 0600, never secrets) and fail-closed loads (a corrupt,
 * structurally invalid, or unknown-schema-version contract never starts
 * execution — ContractValidationError / ContractMigrationError, never a
 * silent empty store).
 *
 * Amendments are optimistic: each save bumps the version counter and appends
 * a changelog entry (version, timestamp, summary); a caller can pin the
 * version it saw (`expectedVersion`) and a stale pin raises
 * ContractVersionConflict instead of overwriting. Multi-node fencing rides
 * the blackboard lease when slice 6.2 wires interpretation; for the
 * multi-process writers this store advertises through `refresh()`, every
 * write holds the store's lock file — the version check and the rename are
 * one critical section, so a writer either lands its amendment or is told it
 * lost (ContractVersionConflict / ContractStoreBusyError), never silently
 * discarded.
 */
import { randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	linkSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	type ProjectContract,
	ContractValidationError,
	migrateProjectContract,
	validateProjectContract,
} from "./schema.ts";

export const CONTRACT_STORE_SCHEMA = "gentle-cowork.contractstore";
export const CONTRACT_STORE_VERSION = 1;

export interface ChangelogEntry {
	version: number;
	at: string;
	summary: string;
}

export interface ContractFile {
	storeSchema: string;
	version: number;
	changelog: ChangelogEntry[];
	contract: ProjectContract;
}

/** The caller's pinned version no longer matches the file on disk. */
export class ContractVersionConflict extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ContractVersionConflict";
	}
}

/** Another process holds the store lock; nothing was written. */
export class ContractStoreBusyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ContractStoreBusyError";
	}
}

export interface ContractStoreOptions {
	/** How long a write waits for the store lock before failing. Default 5000ms. */
	lockTimeoutMs?: number;
	/**
	 * @internal Test seam: runs immediately before the store displaces a lock it judged
	 * dead, so a test can interleave a concurrent reclaimer at exactly the window where
	 * a check-then-delete would destroy the other writer's fresh lock (#65).
	 */
	beforeStaleLockSteal?: () => void;
}

export interface ContractStore {
	readonly filePath: string;
	/** The current file snapshot (a copy), or undefined before the first draft. */
	get(): ContractFile | undefined;
	/** The current business version; 0 before the first draft. */
	version(): number;
	/** Re-reads the file from disk (multi-process coordination). */
	refresh(): void;
	/** Saves the first version; refuses when a contract already exists. */
	draft(contract: ProjectContract, summary: string): ContractFile;
	/**
	 * Applies the update to the current contract, bumps the version, appends
	 * the changelog entry, and persists atomically. The update's result is
	 * validated — an amendment can never store an invalid contract.
	 */
	amend(
		summary: string,
		update: (draft: ProjectContract) => ProjectContract,
		expectedVersion?: number,
	): ContractFile;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_MS = 10;
/**
 * How long a lock whose owner cannot be read must sit untouched before another
 * writer may reclaim it. Its owner cannot be liveness-checked, so age is the
 * only evidence available — and a young one may still be a writer that has
 * created the file and not yet written its owner.
 */
const LOCK_UNREADABLE_GRACE_MS = 30_000;

/** The lock file as observed at one instant: absent, or present with owner and mtime. */
interface LockSnapshot {
	present: boolean;
	owner?: string;
	mtimeMs?: number;
}

const sleepSync = (ms: number): void => {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const parseChangelog = (raw: unknown, version: number): ChangelogEntry[] => {
	if (!Array.isArray(raw)) {
		throw new ContractValidationError(["changelog: required array"]);
	}
	if (raw.length === 0) {
		throw new ContractValidationError(["changelog: required at least one entry for the persisted version"]);
	}
	const entries = raw.map((entry, index): ChangelogEntry => {
		if (!isObject(entry)) {
			throw new ContractValidationError([`changelog[${index}]: expected an object`]);
		}
		if (typeof entry.version !== "number" || !Number.isInteger(entry.version) || entry.version < 1) {
			throw new ContractValidationError([`changelog[${index}].version: required positive integer`]);
		}
		if (typeof entry.at !== "string") {
			throw new ContractValidationError([`changelog[${index}].at: required string`]);
		}
		if (typeof entry.summary !== "string") {
			throw new ContractValidationError([`changelog[${index}].summary: required string`]);
		}
		// One entry per version, in order: a gap or a duplicate is corruption, and
		// an amendment would otherwise write the malformed history forward.
		if (entry.version !== index + 1) {
			throw new ContractValidationError([`changelog[${index}].version: expected ${index + 1}`]);
		}
		return { version: entry.version, at: entry.at, summary: entry.summary };
	});
	const last = entries[entries.length - 1] as ChangelogEntry;
	if (last.version !== version) {
		throw new ContractValidationError([
			`changelog: last entry is version ${last.version} but the envelope holds ${version}`,
		]);
	}
	return entries;
};

export function openContractStore(filePath: string, options: ContractStoreOptions = {}): ContractStore {
	const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
	const lockPath = `${filePath}.lock`;
	let file: ContractFile | undefined;

	/** The raw lock file text, or undefined when it cannot be read. */
	const readLockText = (): string | undefined => {
		try {
			return readFileSync(lockPath, "utf8");
		} catch {
			return undefined;
		}
	};

	/** The lock owner as written in the lock file (`pid:token`), or undefined. */
	const readLockOwner = (): string | undefined => readLockText()?.split("\n")[0]?.trim() || undefined;

	/** The lock file's owner and mtime, or that there is nothing on disk. */
	const readSnapshotOf = (target: string): LockSnapshot => {
		let text: string;
		try {
			text = readFileSync(target, "utf8");
		} catch {
			return { present: false };
		}
		const owner = text.split("\n")[0]?.trim() || undefined;
		try {
			return { present: true, owner, mtimeMs: statSync(target).mtimeMs };
		} catch {
			return { present: false }; // gone between the read and the stat
		}
	};

	const readLockSnapshot = (): LockSnapshot => readSnapshotOf(lockPath);

	/**
	 * Steals the lock only while it is still exactly the snapshot judged dead.
	 *
	 * The comparison alone cannot carry this: between the read and the removal
	 * another waiter may reclaim the same dead lock and create a fresh one of its
	 * own, and removing that fresh lock by path would put two writers inside one
	 * critical section (#65). `rename(2)` is atomic, so exactly one reclaimer moves
	 * whatever is on the path to a name nobody else knows; the moved inode is then
	 * verified against the snapshot meant to be stolen and only that inode is
	 * removed. A lock that changed hands in the window is put back — never
	 * overwritten, never left in limbo — and this caller simply retries.
	 */
	const stealStaleLock = (snapshot: LockSnapshot): boolean => {
		if (!snapshot.present) {
			return false; // nothing on disk to steal
		}
		const current = readLockSnapshot();
		if (!current.present || current.owner !== snapshot.owner || current.mtimeMs !== snapshot.mtimeMs) {
			return false; // taken over in the meantime: steal nothing
		}
		options.beforeStaleLockSteal?.();
		const stolenPath = `${lockPath}.steal-${process.pid}-${randomUUID()}`;
		try {
			renameSync(lockPath, stolenPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return false; // another reclaimer moved it first
			}
			throw error;
		}
		const moved = readSnapshotOf(stolenPath);
		if (moved.owner === snapshot.owner && moved.mtimeMs === snapshot.mtimeMs) {
			rmSync(stolenPath, { force: true }); // only the name this caller stole
			return true;
		}
		restoreStolenLock(stolenPath);
		return false;
	};

	/**
	 * Puts a displaced lock back. `link(2)` is atomic and create-only, so a path a
	 * third writer has already taken is never overwritten; the displaced inode then
	 * stays on disk under its steal name rather than being silently destroyed.
	 */
	const restoreStolenLock = (stolenPath: string): void => {
		try {
			linkSync(stolenPath, lockPath);
		} catch {
			return; // the path is taken again: never displace the new holder
		}
		rmSync(stolenPath, { force: true });
	};

	/**
	 * A readable owner is never displaced by age: a live holder is never stolen,
	 * however slow it is. Elapsed time alone is not evidence of death, and
	 * treating it as such produced two writers inside one critical section, each
	 * reporting success.
	 *
	 * An unreadable owner — absent, empty, or without a positive pid — cannot be
	 * liveness-checked at all; a writer killed between `openSync("wx")` and its
	 * owner write leaves exactly that shape. There, and only there, age is the
	 * evidence: after LOCK_UNREADABLE_GRACE_MS no write can still be holding it,
	 * and never reclaiming it would fail every later writer forever.
	 */
	const reclaimAbandonedLock = (): void => {
		const snapshot = readLockSnapshot();
		if (!snapshot.present) {
			return; // nothing to reclaim
		}
		const pid = Number.parseInt(snapshot.owner?.split(":")[0] ?? "", 10);
		const readable = snapshot.owner !== undefined && Number.isInteger(pid) && pid > 0;
		if (!readable) {
			const ageMs = Date.now() - (snapshot.mtimeMs ?? Date.now());
			if (ageMs < LOCK_UNREADABLE_GRACE_MS) {
				return; // young: possibly a writer that has not written its pid yet
			}
			stealStaleLock(snapshot);
			return;
		}
		if (pid === process.pid) {
			return; // ours: hold it
		}
		try {
			process.kill(pid, 0);
			return; // alive (possibly under another user): hold it
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
				return; // EPERM means alive; anything else is not evidence of death
			}
		}
		stealStaleLock(snapshot); // provably dead: steal it, unless it already moved on
	};

	/** Takes the lock if it is free; never leaves an unowned lock behind. */
	const createLock = (token: string): boolean => {
		let fd: number;
		try {
			fd = openSync(lockPath, "wx", 0o600);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
				throw error;
			}
			return false;
		}
		try {
			writeFileSync(fd, `${token}\n`);
		} catch (error) {
			closeSync(fd);
			// Never a bare delete: another writer may have reclaimed this file and
			// created its own, which must survive this cleanup.
			stealStaleLock(readLockSnapshot());
			throw error;
		}
		closeSync(fd);
		return true;
	};

	const acquireLock = (): string => {
		mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
		const token = `${process.pid}:${randomUUID()}`;
		const deadline = Date.now() + lockTimeoutMs;
		for (;;) {
			// The ownership read after creation closes the reclaim race between two
			// waiters: a writer that finds someone else's token does not proceed.
			if (createLock(token) && readLockOwner() === token) {
				return token;
			}
			reclaimAbandonedLock();
			if (Date.now() >= deadline) {
				throw new ContractStoreBusyError(
					`contract store is held by ${readLockOwner() ?? "another process"} (${lockPath}) — nothing was written, retry the write`,
				);
			}
			sleepSync(LOCK_RETRY_MS);
		}
	};

	/**
	 * The version check, the update and the rename are one critical section
	 * across processes, and the lock is released only while this writer still
	 * owns it: a writer whose lock was taken over never deletes the new holder's.
	 */
	const withLock = <T>(action: () => T): T => {
		const token = acquireLock();
		try {
			return action();
		} finally {
			if (readLockOwner() === token) {
				rmSync(lockPath, { force: true });
			}
		}
	};

	const load = (): void => {
		if (!existsSync(filePath)) {
			file = undefined;
			return;
		}
		let raw: unknown;
		try {
			raw = JSON.parse(readFileSync(filePath, "utf8"));
		} catch (error) {
			throw new ContractValidationError([`contract file is not valid JSON: ${(error as Error).message}`]);
		}
		if (!isObject(raw) || raw.storeSchema !== `${CONTRACT_STORE_SCHEMA}/v${CONTRACT_STORE_VERSION}`) {
			throw new ContractValidationError([`storeSchema: expected ${CONTRACT_STORE_SCHEMA}/v${CONTRACT_STORE_VERSION}`]);
		}
		if (typeof raw.version !== "number" || !Number.isInteger(raw.version) || raw.version < 0) {
			throw new ContractValidationError(["version: required non-negative integer"]);
		}
		// A corrupt envelope never loads: the changelog is validated entry by
		// entry and must agree with the persisted version, or an amendment would
		// write malformed audit history forward.
		const changelog = parseChangelog(raw.changelog, raw.version);
		// Fail closed: migration and validation errors propagate to the caller.
		const contract = migrateProjectContract(raw.contract);
		file = {
			storeSchema: raw.storeSchema,
			version: raw.version,
			changelog,
			contract,
		};
	};

	const write = (next: ContractFile): void => {
		mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
		const tmp = join(dirname(filePath), `.contract-${randomUUID()}.tmp`);
		try {
			writeFileSync(tmp, `${JSON.stringify(next, null, "\t")}\n`, { mode: 0o600 });
			renameSync(tmp, filePath);
		} catch (error) {
			// A failed write never leaves a contract body behind for a later
			// loader (or an operator) to mistake for state.
			rmSync(tmp, { force: true });
			throw error;
		}
		file = next;
	};

	load();

	return {
		filePath,
		get() {
			return file === undefined ? undefined : (structuredClone(file) as ContractFile);
		},
		version() {
			return file?.version ?? 0;
		},
		refresh() {
			load();
		},
		draft(contract, summary) {
			return withLock(() => {
				load();
				if (file !== undefined) {
					throw new ContractValidationError([
						`a contract already exists at ${filePath} (version ${file.version}) — use amend`,
					]);
				}
				const next: ContractFile = {
					storeSchema: `${CONTRACT_STORE_SCHEMA}/v${CONTRACT_STORE_VERSION}`,
					version: 1,
					changelog: [{ version: 1, at: new Date().toISOString(), summary }],
					// A copy: a caller mutating its own object can never edit what is cached here.
					contract: structuredClone(validateProjectContract(contract)),
				};
				write(next);
				return structuredClone(next);
			});
		},
		amend(summary, update, expectedVersion) {
			return withLock(() => {
				load();
				if (file === undefined) {
					throw new ContractValidationError(["no contract drafted yet — use draft first"]);
				}
				if (expectedVersion !== undefined && file.version !== expectedVersion) {
					throw new ContractVersionConflict(
						`expected version ${expectedVersion} but the file holds ${file.version}`,
					);
				}
				const updated = validateProjectContract(update(structuredClone(file.contract)));
				const next: ContractFile = {
					...file,
					version: file.version + 1,
					changelog: [...file.changelog, { version: file.version + 1, at: new Date().toISOString(), summary }],
					contract: structuredClone(updated),
				};
				write(next);
				return structuredClone(next);
			});
		},
	};
}
