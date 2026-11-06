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
	existsSync,
	linkSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	rmdirSync,
	statSync,
	type Stats,
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
	/**
	 * @internal Test seam: runs immediately before a parked owner goes back, so a test
	 * can probe the window where a displaced lock is off its canonical name (#69).
	 */
	beforeStaleLockRestore?: () => void;
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

/** The owner file inside the lock container. */
const LOCK_OWNER_NAME = "owner";
/** Names a displaced owner is parked under, inside the same container. */
const LOCK_TAKEN_PREFIX = "taken-";

/** The published owner, or a dispute file a reclaimer left behind while displacing one. */
interface LockEntry {
	name: string;
	token?: string;
	mtimeMs: number;
}

/**
 * The lock as observed at one instant. A directory is the protocol; a regular
 * file is a pre-directory artifact from a mixed-version rollout.
 */
type LockView =
	| { kind: "absent" }
	| { kind: "unreadable" }
	| { kind: "legacy"; token?: string; mtimeMs: number }
	| { kind: "directory"; owner?: LockEntry; taken: LockEntry[]; mtimeMs: number };

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
	const ownerPath = join(lockPath, LOCK_OWNER_NAME);
	let file: ContractFile | undefined;

	/** One entry of the container, by name; undefined when it vanished mid-read. */
	const readLockEntry = (target: string, name: string): LockEntry | undefined => {
		try {
			const token = readFileSync(target, "utf8").split("\n")[0]?.trim() || undefined;
			return { name, token, mtimeMs: statSync(target).mtimeMs };
		} catch {
			return undefined;
		}
	};

	/**
	 * The lock as it is on disk right now.
	 *
	 * The lock is a directory. Acquiring it is `mkdir(2)` — atomic and create-only —
	 * and its existence alone blocks every other writer, so ownership inside it can
	 * be displaced and put back without ever exposing a path that looks free. That
	 * is the property the file-based protocol could not give: it had to delete a
	 * name to reclaim, and the deletion window is where two writers could enter one
	 * critical section (#65) and where a third could enter while a displaced lock was
	 * off the path (#69).
	 */
	const viewLock = (): LockView => {
		let stats: Stats;
		try {
			stats = statSync(lockPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return { kind: "absent" };
			}
			return { kind: "unreadable" }; // a lock we cannot stat is not evidence of freedom
		}
		if (!stats.isDirectory()) {
			// A regular file here predates the container protocol (mixed-version rollout).
			const legacy = readLockEntry(lockPath, "lock");
			return { kind: "legacy", token: legacy?.token, mtimeMs: legacy?.mtimeMs ?? stats.mtimeMs };
		}
		const owner = readLockEntry(ownerPath, LOCK_OWNER_NAME);
		let names: string[];
		try {
			names = readdirSync(lockPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return { kind: "absent" }; // the container vanished between the stat and the listing
			}
			// Any other failure (EACCES, EIO) hides the dispute evidence. Reporting an
			// empty listing would let this writer settle a container whose taken-* still
			// names a live holder, so a container we cannot list is not evidence of
			// anything and is left alone (review R4-003).
			return { kind: "unreadable" };
		}
		const taken = names
			.filter((name) => name.startsWith(LOCK_TAKEN_PREFIX))
			.sort()
			.flatMap((name) => {
				const entry = readLockEntry(join(lockPath, name), name);
				return entry === undefined ? [] : [entry];
			});
		return { kind: "directory", owner, taken, mtimeMs: stats.mtimeMs };
	};

	/** The token currently published as the owner, or undefined. */
	const readLockOwner = (): string | undefined => {
		const view = viewLock();
		if (view.kind === "directory") return view.owner?.token;
		if (view.kind === "legacy") return view.token;
		return undefined;
	};

	const ownerPid = (token: string | undefined): number | undefined => {
		const pid = Number.parseInt(token?.split(":")[0] ?? "", 10);
		return token !== undefined && Number.isInteger(pid) && pid > 0 ? pid : undefined;
	};

	/** Only `ESRCH` proves death: `EPERM` means alive, anything else is no evidence. */
	const provablyDead = (pid: number): boolean => {
		if (pid === process.pid) return false; // ours: wait for ourselves, never displace
		try {
			process.kill(pid, 0);
			return false;
		} catch (error) {
			return (error as NodeJS.ErrnoException).code === "ESRCH";
		}
	};

	/** Frees the container this process owns: its own owner file, then the directory. */
	const releaseLockContainer = (): void => {
		rmSync(ownerPath, { force: true });
		try {
			rmdirSync(lockPath); // a leftover dispute file keeps it: the next acquirer settles it
		} catch {
			/* not empty, or already gone */
		}
	};

	/**
	 * Takes the lock if the container is free. Ownership is established by the
	 * `mkdir`: no other writer can create this name while it exists, so publishing
	 * the owner inside it cannot race with anyone. A failure here frees only the
	 * container this process created — never a snapshot compared after the fact,
	 * which was vacuous because it was taken after the failure (#69).
	 */
	const createLock = (token: string): boolean => {
		try {
			mkdirSync(lockPath, { mode: 0o700 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
				throw error;
			}
			return false;
		}
		try {
			writeFileSync(ownerPath, `${token}\n`, { mode: 0o600, flag: "wx" });
		} catch (error) {
			releaseLockContainer();
			throw error;
		}
		return readLockEntry(ownerPath, LOCK_OWNER_NAME)?.token === token;
	};

	/**
	 * Puts a displaced owner back. `link(2)` is atomic and create-only, so an owner
	 * already republished is never overwritten; and because the container still
	 * exists, no third writer can have acquired the store in the meantime — that is
	 * exactly the window #69 closed.
	 */
	const restoreDisputedOwner = (entry: LockEntry): void => {
		options.beforeStaleLockRestore?.();
		const source = join(lockPath, entry.name);
		try {
			linkSync(source, ownerPath);
		} catch {
			// Someone republished an owner first: ours is a duplicate. Keep the dispute
			// file while its holder may still be alive, drop it once it is provably dead.
			const published = readLockEntry(ownerPath, LOCK_OWNER_NAME);
			const pid = ownerPid(entry.token);
			if (published !== undefined && (pid === undefined || provablyDead(pid))) {
				rmSync(source, { force: true });
			}
			return;
		}
		rmSync(source, { force: true });
	};

	/**
	 * Finishes a dispute a crashed reclaimer left behind. The parked owner is the
	 * evidence: a live holder is put back and keeps running untouched; a dead or
	 * long-unreadable one is cleared so the container can be released (#69, S4/S6).
	 */
	const settleDispute = (entry: LockEntry): void => {
		const pid = ownerPid(entry.token);
		if (pid !== undefined) {
			if (!provablyDead(pid)) {
				restoreDisputedOwner(entry);
				return;
			}
		} else if (Date.now() - entry.mtimeMs < LOCK_UNREADABLE_GRACE_MS) {
			return; // young and unreadable: the reclaimer that parked it may still be working
		}
		rmSync(join(lockPath, entry.name), { force: true });
	};

	/**
	 * Takes over a lock whose owner is proven dead. The owner file is moved aside
	 * *inside* the container and compared with the token judged dead: a mismatch
	 * means the lock changed hands, so it goes back and the caller retries. Nothing
	 * is deleted by path, which is what #65 fixed half-way and #69 finished.
	 *
	 * `expected` undefined means the parked owner was unreadable, so whatever the
	 * rename moved is the artifact that was judged — it cannot have changed hands.
	 */
	const displaceOwner = (expected: string | undefined): void => {
		options.beforeStaleLockSteal?.();
		const name = `${LOCK_TAKEN_PREFIX}${process.pid}-${randomUUID()}`;
		const target = join(lockPath, name);
		try {
			renameSync(ownerPath, target);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return; // another reclaimer moved it first
			}
			throw error;
		}
		const moved = readLockEntry(target, name);
		if (moved === undefined) {
			return;
		}
		if (expected !== undefined && moved.token !== expected) {
			restoreDisputedOwner(moved);
			return;
		}
		rmSync(target, { force: true }); // exactly the owner judged dead
		releaseLockContainer();
	};

	/** A regular file at the lock path predates the container protocol. */
	const settleLegacyLock = (view: { token?: string; mtimeMs: number }): void => {
		const pid = ownerPid(view.token);
		if (pid !== undefined) {
			if (!provablyDead(pid)) {
				return;
			}
		} else if (Date.now() - view.mtimeMs < LOCK_UNREADABLE_GRACE_MS) {
			return;
		}
		// Nothing protects a plain file, so unlinking it by path is the only way to
		// free it. Mixed-version rollouts upgrade every writer together (S5 in
		// odd/tasks/contract-lock-protocol.md).
		rmSync(lockPath, { force: true });
	};

	/**
	 * Makes progress on a lock this process does not own: finishes a crashed
	 * reclaimer's dispute, and takes over an owner that is provably dead. A live
	 * holder is never displaced by age — elapsed time is not evidence of death, and
	 * treating it as such produced two writers inside one critical section.
	 */
	const settleLock = (): void => {
		const view = viewLock();
		if (view.kind === "absent" || view.kind === "unreadable") {
			return;
		}
		if (view.kind === "legacy") {
			settleLegacyLock(view);
			return;
		}
		for (const entry of view.taken) {
			settleDispute(entry);
		}
		const after = viewLock();
		if (after.kind !== "directory") {
			return; // the dispute work above released it or it went away
		}
		const owner = after.owner;
		if (owner === undefined) {
			// A writer that died between `mkdir` and its owner write, or one still inside
			// that window: age is the only evidence, and a young one is never touched.
			if (Date.now() - after.mtimeMs >= LOCK_UNREADABLE_GRACE_MS) {
				releaseLockContainer();
			}
			return;
		}
		const pid = ownerPid(owner.token);
		if (pid === undefined) {
			if (Date.now() - owner.mtimeMs >= LOCK_UNREADABLE_GRACE_MS) {
				displaceOwner(undefined);
			}
			return;
		}
		if (!provablyDead(pid)) {
			return; // alive (possibly under another user): hold it
		}
		displaceOwner(owner.token ?? undefined);
	};

	const acquireLock = (): string => {
		mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
		const token = `${process.pid}:${randomUUID()}`;
		const deadline = Date.now() + lockTimeoutMs;
		for (;;) {
			if (createLock(token)) {
				return token;
			}
			settleLock();
			if (Date.now() >= deadline) {
				throw new ContractStoreBusyError(
					`contract store is held by ${readLockOwner() ?? "another process"} (${lockPath}) — nothing was written, retry the write`,
				);
			}
			sleepSync(LOCK_RETRY_MS);
		}
	};

	/**
	 * The version check, the update and the rename are one critical section across
	 * processes, and the lock is released only while this writer still owns it: a
	 * writer whose lock was taken over never releases the new holder's.
	 */
	const withLock = <T>(action: () => T): T => {
		const token = acquireLock();
		try {
			return action();
		} finally {
			if (readLockOwner() === token) {
				releaseLockContainer();
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
