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
 * the blackboard lease when slice 6.2 wires interpretation; this store keeps
 * single-writer correctness with the version counter.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

/**
 * A corrupt envelope never loads: every changelog entry is validated and must
 * agree with the persisted version, or an amendment would write malformed
 * audit history forward instead of failing closed.
 */
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
		// One entry per version, in order: a gap or a duplicate is corruption, not
		// history to carry forward.
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

export function openContractStore(filePath: string): ContractStore {
	let file: ContractFile | undefined;

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
		// A corrupt envelope never loads: the changelog is validated entry by entry
		// and must agree with the persisted version.
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
		writeFileSync(tmp, `${JSON.stringify(next, null, "\t")}\n`, { mode: 0o600 });
		renameSync(tmp, filePath);
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
		},
		amend(summary, update, expectedVersion) {
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
		},
	};
}
