/**
 * Contract interpreter (slice 6.2): deterministic, fail-closed interpretation of a
 * ProjectContract into executable TaskContracts, evaluated gates, and exposed budget.
 * The foundational fixture is the retrospective T8 contract with its real data.
 */
import type { ProjectContract, DeliverableStatus, Gate, GateKind, GateState, ScopeClause, Budget } from "./schema.ts";
import type { TaskContract, ContractHistoryEntry } from "../types.ts";

export type GateKindWithDeadline = GateKind | "deadline";

export interface GateEvaluation {
	id: string;
	kind: GateKindWithDeadline;
	state: "passed" | "open" | "paused" | "overdue";
	appliesTo: string;
	detail: string;
}

export interface InterpretationResult {
	contractId: string;
	contracts: TaskContract[];
	skipped: Array<{ deliverableId: string; status: "delivered" | "blocked"; detail: string }>;
	scopeClauses: ScopeClause[];
	gates: GateEvaluation[];
	budget: Budget;
	generatedAt: string;
}

const GATE_STATE_DETAILS: Record<GateState, string> = {
	passed: "gate passed",
	open: "gate open — blocks progression",
	paused: "gate paused",
};

/** Parses an ISO date string safely; returns null if invalid. */
function parseDeadline(value: string | null): Date | null {
	if (value === null) return null;
	const parsed = new Date(value);
	return isNaN(parsed.getTime()) ? null : parsed;
}

/** Evaluates a declared gate from the contract. */
function evaluateDeclaredGate(gate: Gate, generatedAt: string): GateEvaluation {
	const detail = gate.state === "passed" ? (gate.evidence ?? GATE_STATE_DETAILS[gate.state]) : GATE_STATE_DETAILS[gate.state];
	return {
		id: `gate:${gate.id}`,
		kind: gate.kind,
		state: gate.state,
		appliesTo: gate.appliesTo,
		detail,
	};
}

/** Evaluates a derived deadline gate (hard or soft). Returns null when no gate should be created. */
function evaluateDeadlineGate(
	kind: "hard" | "soft",
	deadlineValue: string | null,
	now: Date,
	generatedAt: string,
): GateEvaluation | null {
	if (deadlineValue === null) {
		// Explicit null → no derived gate (per spec)
		return null;
	}
	const deadline = parseDeadline(deadlineValue);
	const id = `deadline:${kind}`;
	const appliesTo = `${kind} deadline`;

	if (deadline === null) {
		// Malformed deadline string → fail closed (overdue)
		return {
			id,
			kind: "deadline",
			state: "overdue",
			appliesTo,
			detail: `malformed deadline (${deadlineValue}) — fail closed`,
		};
	}

	const isOverdue = now > deadline;
	const state: "overdue" | "open" = isOverdue ? "overdue" : "open";
	const deadlineISO = deadline.toISOString();
	const nowISO = now.toISOString();

	let detail: string;
	if (isOverdue) {
		detail = `${kind} deadline passed (deadline: ${deadlineISO}, now: ${nowISO})`;
	} else {
		detail = `${kind} deadline not reached`;
	}

	return { id, kind: "deadline", state, appliesTo, detail };
}

/**
 * Interprets a ProjectContract into executable TaskContracts and evaluated gates.
 * Fail-closed: malformed deadlines produce overdue gates (never throw).
 * Deterministic: same contract + same now → deep-equal results.
 */
export function interpretContract(contract: ProjectContract, options?: { now?: Date }): InterpretationResult {
	const now = options?.now ?? new Date();
	const generatedAt = now.toISOString();

	// 1. Build TaskContracts for PENDING deliverables; collect skipped for delivered/blocked
	const contracts: TaskContract[] = [];
	const skipped: Array<{ deliverableId: string; status: "delivered" | "blocked"; detail: string }> = [];

	for (const deliverable of contract.deliverables) {
		if (deliverable.status === "delivered") {
			skipped.push({
				deliverableId: deliverable.id,
				status: "delivered",
				detail: "already delivered",
			});
			continue;
		}
		if (deliverable.status === "blocked") {
			skipped.push({
				deliverableId: deliverable.id,
				status: "blocked",
				detail: "blocked deliverable — requires manual unblocking",
			});
			continue;
		}

		// status === "pending"
		const acceptanceCriteria = deliverable.acceptance.map((a) => `[${a.kind}] ${a.assert}`);
		const specRef = deliverable.specRef ?? `contract:${contract.id}`;

		const historyEntry: ContractHistoryEntry = {
			status: "pending",
			version: 1,
			nodeId: "contract-interpreter",
			timestamp: generatedAt,
		};

		const taskContract: TaskContract = {
			id: `${contract.id}-${deliverable.id}`,
			objective: deliverable.title,
			role: "implementer",
			scope: [], // v1: schema carries restrictions (scopeClauses), not per-deliverable positive surfaces
			acceptanceCriteria,
			specRef,
			artifacts: [],
			status: "pending",
			version: 1,
			history: [historyEntry],
			retryCount: 0,
		};

		contracts.push(taskContract);
	}

	// 2. Evaluate declared gates
	const gateEvaluations: GateEvaluation[] = contract.gates.map((gate) =>
		evaluateDeclaredGate(gate, generatedAt),
	);

	// 3. Add derived deadline gates (only when not null)
	const hardGate = evaluateDeadlineGate("hard", contract.deadlines.hard, now, generatedAt);
	const softGate = evaluateDeadlineGate("soft", contract.deadlines.soft, now, generatedAt);
	if (hardGate !== null) gateEvaluations.push(hardGate);
	if (softGate !== null) gateEvaluations.push(softGate);

	// 4. Return the interpretation result
	return {
		contractId: contract.id,
		contracts,
		skipped,
		scopeClauses: contract.scopeClauses, // verbatim for the router
		gates: gateEvaluations,
		budget: contract.budget, // verbatim (limits AND measured) — 6.3/6.4 consume
		generatedAt,
	};
}