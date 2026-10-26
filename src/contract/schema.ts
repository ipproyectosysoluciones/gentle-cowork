/**
 * ProjectContract schema (slice 6.1, odd/tasks/phase6-slice61-contract-schema.md):
 * the business-level contract that defines what a project owes, how its quality is
 * measured, what stays out of scope, how much it may spend, and which gates must
 * open before it ships. Fail closed: an invalid or unknown-version contract never
 * starts execution.
 *
 * The foundational example is the retrospective T8 contract (the dot-whatsapp
 * admin API): its deliverables, its 51/51 acceptance, its real provider-storm
 * cost, and the four gates that actually operated — modeled, not idealized.
 *
 * Versioning: `schema` carries "gentle-cowork.projectcontract/vN". Loading runs
 * the registered up-migration chain vN → current, then validates. A version this
 * build does not know fails closed (ContractMigrationError); amendments produce
 * vN+1 with a changelog entry, never a silent edit.
 */

export const PROJECT_CONTRACT_SCHEMA = "gentle-cowork.projectcontract";
export const PROJECT_CONTRACT_SCHEMA_VERSION = 1;

export type AcceptanceKind = "tests" | "typecheck" | "e2e-live" | "lint" | "manual";
export type DeliverableStatus = "pending" | "delivered" | "blocked";
export type GateKind = "user-decision" | "native-review" | "slice-boundary" | "publish";
export type GateState = "passed" | "open" | "paused";

export interface Acceptance {
	kind: AcceptanceKind;
	assert: string;
	evidence?: string;
}

export interface Deliverable {
	id: string;
	title: string;
	specRef?: string;
	acceptance: Acceptance[];
	status: DeliverableStatus;
}

export interface ScopeClause {
	id: string;
	rule: string;
	enforcement: string;
}

export interface BudgetLimit {
	limit: number | null;
	measured: number | null;
}

export interface Budget {
	modelCalls: BudgetLimit;
	tokens: BudgetLimit;
	wallTime: BudgetLimit;
}

export interface QualityMetric {
	metric: string;
	target: string;
	measured: string | number | null;
}

export interface Deadlines {
	soft: string | null;
	hard: string | null;
}

export interface Gate {
	id: string;
	kind: GateKind;
	appliesTo: string;
	state: GateState;
	evidence?: string;
}

export interface ContractMeta {
	commits: string[];
	reviewLineage?: string;
	issueRef?: string;
}

export interface ProjectContract {
	schema: string;
	id: string;
	title: string;
	objective: string;
	branch: string;
	deliverables: Deliverable[];
	scopeClauses: ScopeClause[];
	deadlines: Deadlines;
	qualityMetrics: QualityMetric[];
	budget: Budget;
	gates: Gate[];
	meta: ContractMeta;
}

/** Every problem found in one pass, with the field path for each. */
export class ContractValidationError extends Error {
	readonly issues: string[];
	constructor(issues: string[]) {
		super(`invalid project contract: ${issues.join("; ")}`);
		this.name = "ContractValidationError";
		this.issues = issues;
	}
}

/** The contract's declared version is unknown to this build, or malformed. */
export class ContractMigrationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ContractMigrationError";
	}
}

const ACCEPTANCE_KINDS: readonly AcceptanceKind[] = ["tests", "typecheck", "e2e-live", "lint", "manual"];
const DELIVERABLE_STATUSES: readonly DeliverableStatus[] = ["pending", "delivered", "blocked"];
const GATE_KINDS: readonly GateKind[] = ["user-decision", "native-review", "slice-boundary", "publish"];
const GATE_STATES: readonly GateState[] = ["passed", "open", "paused"];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isNonEmptyString = (v: unknown): v is string => isString(v) && v.trim() !== "";
const isNumberOrNull = (v: unknown): v is number | null => v === null || typeof v === "number";
const isStringOrNull = (v: unknown): v is string | null => v === null || isString(v);

const SCHEMA_RE = /^gentle-cowork\.projectcontract\/v(\d+)$/;

/** Reads the declared schema version, or null when the string is not ours. */
export function parseSchemaVersion(raw: unknown): number | null {
	if (!isObject(raw) || !isString(raw.schema)) return null;
	const match = SCHEMA_RE.exec(raw.schema);
	return match ? Number(match[1]) : null;
}

/** Up-migrations registered by later builds: vN → vN+1. */
const MIGRATIONS: Record<number, (raw: unknown) => unknown> = {};

/** Registers one up-migration; later builds call this at module load. */
export function registerMigration(fromVersion: number, up: (raw: unknown) => unknown): void {
	MIGRATIONS[fromVersion] = up;
}

/** Runs the registered migration chain up to the current version, then validates. */
export function migrateProjectContract(raw: unknown): ProjectContract {
	const version = parseSchemaVersion(raw);
	if (version === null) {
		throw new ContractMigrationError("the contract's schema string is missing or not gentle-cowork.projectcontract/vN");
	}
	if (version > PROJECT_CONTRACT_SCHEMA_VERSION) {
		throw new ContractMigrationError(
			`projectcontract/v${version} is newer than this build understands (v${PROJECT_CONTRACT_SCHEMA_VERSION})`,
		);
	}
	let current = raw as unknown;
	let v = version;
	while (v < PROJECT_CONTRACT_SCHEMA_VERSION) {
		const up = MIGRATIONS[v];
		if (!up) throw new ContractMigrationError(`no migration registered from projectcontract/v${v}`);
		current = up(current);
		v += 1;
	}
	return validateProjectContract(current);
}

/** Validates one value as a current-version ProjectContract; throws with all issues. */
export function validateProjectContract(value: unknown): ProjectContract {
	const issues: string[] = [];
	if (!isObject(value)) {
		throw new ContractValidationError(["root: expected an object"]);
	}
	if (value.schema !== `${PROJECT_CONTRACT_SCHEMA}/v${PROJECT_CONTRACT_SCHEMA_VERSION}`) {
		issues.push("schema: must be exactly the current version string");
	}
	for (const field of ["id", "title", "objective", "branch"] as const) {
		if (!isNonEmptyString(value[field])) issues.push(`${field}: required non-empty string`);
	}

	const deliverables = value.deliverables;
	if (!Array.isArray(deliverables) || deliverables.length === 0) {
		issues.push("deliverables: required non-empty array");
	} else {
		const seenIds = new Set<string>();
		deliverables.forEach((d, index) => {
			const at = `deliverables[${index}]`;
			if (!isObject(d)) {
				issues.push(`${at}: expected an object`);
				return;
			}
			if (!isNonEmptyString(d.id)) issues.push(`${at}.id: required non-empty string`);
			else if (seenIds.has(d.id)) issues.push(`${at}.id: duplicate id "${d.id}"`);
			else seenIds.add(d.id);
			if (!isNonEmptyString(d.title)) issues.push(`${at}.title: required non-empty string`);
			if (d.specRef !== undefined && !isNonEmptyString(d.specRef)) issues.push(`${at}.specRef: must be a non-empty string when present`);
			if (!isNonEmptyString(d.status) || !DELIVERABLE_STATUSES.includes(d.status as DeliverableStatus)) {
				issues.push(`${at}.status: must be one of ${DELIVERABLE_STATUSES.join("|")}`);
			}
			if (!Array.isArray(d.acceptance) || d.acceptance.length === 0) {
				issues.push(`${at}.acceptance: required non-empty array of acceptance criteria`);
				return;
			}
			d.acceptance.forEach((a, ai) => {
				const atA = `${at}.acceptance[${ai}]`;
				if (!isObject(a)) {
					issues.push(`${atA}: expected an object`);
					return;
				}
				if (!isNonEmptyString(a.kind) || !ACCEPTANCE_KINDS.includes(a.kind as AcceptanceKind)) {
					issues.push(`${atA}.kind: must be one of ${ACCEPTANCE_KINDS.join("|")}`);
				}
				if (!isNonEmptyString(a.assert)) issues.push(`${atA}.assert: required non-empty string`);
				if (a.evidence !== undefined && !isNonEmptyString(a.evidence)) issues.push(`${atA}.evidence: must be a non-empty string when present`);
			});
		});
	}

	if (!Array.isArray(value.scopeClauses)) {
		issues.push("scopeClauses: required array");
	} else {
		const seenIds = new Set<string>();
		value.scopeClauses.forEach((c, index) => {
			const at = `scopeClauses[${index}]`;
			if (!isObject(c)) {
				issues.push(`${at}: expected an object`);
				return;
			}
			if (!isNonEmptyString(c.id)) issues.push(`${at}.id: required non-empty string`);
			else if (seenIds.has(c.id)) issues.push(`${at}.id: duplicate id "${c.id}"`);
			else seenIds.add(c.id);
			if (!isNonEmptyString(c.rule)) issues.push(`${at}.rule: required non-empty string`);
			if (!isNonEmptyString(c.enforcement)) issues.push(`${at}.enforcement: required non-empty string`);
		});
	}

	const deadlines = value.deadlines;
	if (!isObject(deadlines) || !isStringOrNull(deadlines.soft) || !isStringOrNull(deadlines.hard)) {
		issues.push("deadlines: required object with soft and hard (string or null)");
	}

	if (!Array.isArray(value.qualityMetrics)) {
		issues.push("qualityMetrics: required array");
	} else {
		value.qualityMetrics.forEach((m, index) => {
			const at = `qualityMetrics[${index}]`;
			if (!isObject(m)) {
				issues.push(`${at}: expected an object`);
				return;
			}
			if (!isNonEmptyString(m.metric)) issues.push(`${at}.metric: required non-empty string`);
			if (!isNonEmptyString(m.target)) issues.push(`${at}.target: required non-empty string`);
			if (m.measured !== undefined && !isStringOrNull(m.measured) && typeof m.measured !== "number") {
				issues.push(`${at}.measured: must be a string, number, or null`);
			}
		});
	}

	const budget = value.budget;
	if (!isObject(budget)) {
		issues.push("budget: required object with modelCalls, tokens, and wallTime");
	} else {
		for (const key of ["modelCalls", "tokens", "wallTime"] as const) {
			const limit = budget[key];
			if (!isObject(limit) || !isNumberOrNull(limit.limit) || !isNumberOrNull(limit.measured)) {
				issues.push(`budget.${key}: required object with limit and measured (number or null)`);
			}
		}
	}

	if (!Array.isArray(value.gates)) {
		issues.push("gates: required array");
	} else {
		const seenIds = new Set<string>();
		value.gates.forEach((g, index) => {
			const at = `gates[${index}]`;
			if (!isObject(g)) {
				issues.push(`${at}: expected an object`);
				return;
			}
			if (!isNonEmptyString(g.id)) issues.push(`${at}.id: required non-empty string`);
			else if (seenIds.has(g.id)) issues.push(`${at}.id: duplicate id "${g.id}"`);
			else seenIds.add(g.id);
			if (!isNonEmptyString(g.kind) || !GATE_KINDS.includes(g.kind as GateKind)) {
				issues.push(`${at}.kind: must be one of ${GATE_KINDS.join("|")}`);
			}
			if (!isNonEmptyString(g.appliesTo)) issues.push(`${at}.appliesTo: required non-empty string`);
			if (!isNonEmptyString(g.state) || !GATE_STATES.includes(g.state as GateState)) {
				issues.push(`${at}.state: must be one of ${GATE_STATES.join("|")}`);
			}
			if (g.evidence !== undefined && !isNonEmptyString(g.evidence)) issues.push(`${at}.evidence: must be a non-empty string when present`);
		});
	}

	const meta = value.meta;
	if (!isObject(meta)) {
		issues.push("meta: required object");
	} else {
		if (!Array.isArray(meta.commits) || meta.commits.length === 0 || !meta.commits.every(isNonEmptyString)) {
			issues.push("meta.commits: required non-empty array of commit ids");
		}
		if (meta.reviewLineage !== undefined && !isNonEmptyString(meta.reviewLineage)) {
			issues.push("meta.reviewLineage: must be a non-empty string when present");
		}
		if (meta.issueRef !== undefined && !isNonEmptyString(meta.issueRef)) {
			issues.push("meta.issueRef: must be a non-empty string when present");
		}
	}

	if (issues.length > 0) throw new ContractValidationError(issues);
	return value as unknown as ProjectContract;
}
