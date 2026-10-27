// Contract interpreter (slice 6.2): deterministic, fail-closed interpretation of a
// ProjectContract into executable TaskContracts, evaluated gates, and exposed budget.
// The foundational fixture is the retrospective T8 contract with its real data.
import { describe, expect, it } from "vitest";
import { t8Contract } from "./fixtures.ts";
import { interpretContract } from "./interpreter.ts";

describe("interpretContract — T8 fixture interpretation", () => {
	it("maps pending deliverables to TaskContracts with correct id, objective, and acceptance criteria", () => {
		// T8 has 1 deliverable (D1) with status "delivered" — we need a contract with pending deliverables
		const contractWithPending = {
			...t8Contract,
			deliverables: [
				{ ...t8Contract.deliverables[0], id: "D1-pending", status: "pending" as const },
				{
					id: "D2-pending",
					title: "Second pending deliverable",
					specRef: "odd/tasks/spec.md#S2",
					acceptance: [
						{ kind: "tests" as const, assert: "all green" },
						{ kind: "typecheck" as const, assert: "clean" },
					],
					status: "pending" as const,
				},
			],
		};

		const result = interpretContract(contractWithPending, { now: new Date("2026-10-25T12:00:00Z") });

		expect(result.contracts).toHaveLength(2);
		const [c1, c2] = result.contracts;
		expect(c1.id).toBe(`${contractWithPending.id}-D1-pending`);
		expect(c1.objective).toBe("Admin API según S6 (status/allowlist/pair/verify/unpair)");
		expect(c1.acceptanceCriteria).toEqual([
			"[tests] 51/51 green; 29 pre-existing unmodified",
			"[typecheck] tsc --noEmit clean",
			"[e2e-live] GET /status + /allowlist + circuito WS responden",
		]);
		expect(c2.id).toBe(`${contractWithPending.id}-D2-pending`);
		expect(c2.objective).toBe("Second pending deliverable");
		expect(c2.acceptanceCriteria).toEqual(["[tests] all green", "[typecheck] clean"]);
	});

	it("skips delivered deliverables with correct detail", () => {
		const result = interpretContract(t8Contract, { now: new Date("2026-10-25T12:00:00Z") });

		expect(result.contracts).toHaveLength(0);
		expect(result.skipped).toHaveLength(1);
		expect(result.skipped[0]).toEqual({
			deliverableId: "D1",
			status: "delivered",
			detail: "already delivered",
		});
	});

	it("skips blocked deliverables with correct detail", () => {
		const contractWithBlocked = {
			...t8Contract,
			deliverables: [
				{ ...t8Contract.deliverables[0], id: "D1-blocked", status: "blocked" as const },
			],
		};

		const result = interpretContract(contractWithBlocked, { now: new Date("2026-10-25T12:00:00Z") });

		expect(result.contracts).toHaveLength(0);
		expect(result.skipped).toHaveLength(1);
		expect(result.skipped[0]).toEqual({
			deliverableId: "D1-blocked",
			status: "blocked",
			detail: "blocked deliverable — requires manual unblocking",
		});
	});

	it("preserves declaration order of pending deliverables in TaskContracts", () => {
		const contractWithOrdered = {
			...t8Contract,
			deliverables: [
				{ id: "D1", title: "First", acceptance: [{ kind: "tests" as const, assert: "a" }], status: "pending" as const },
				{ id: "D2", title: "Second", acceptance: [{ kind: "tests" as const, assert: "b" }], status: "pending" as const },
				{ id: "D3", title: "Third", acceptance: [{ kind: "tests" as const, assert: "c" }], status: "pending" as const },
			],
		};

		const result = interpretContract(contractWithOrdered, { now: new Date("2026-10-25T12:00:00Z") });

		expect(result.contracts.map((c) => c.id)).toEqual([
			"dot-whatsapp-admin-api-D1",
			"dot-whatsapp-admin-api-D2",
			"dot-whatsapp-admin-api-D3",
		]);
	});
});

describe("interpretContract — acceptance criteria mapping", () => {
	it("keeps the [kind] prefix on each acceptance criterion", () => {
		const contract = {
			...t8Contract,
			deliverables: [
				{
					id: "D1",
					title: "Test",
					acceptance: [
						{ kind: "tests" as const, assert: "suite green" },
						{ kind: "lint" as const, assert: "no warnings" },
						{ kind: "manual" as const, assert: "reviewer approves" },
					],
					status: "pending" as const,
				},
			],
		};

		const result = interpretContract(contract, { now: new Date("2026-10-25T12:00:00Z") });

		expect(result.contracts[0].acceptanceCriteria).toEqual([
			"[tests] suite green",
			"[lint] no warnings",
			"[manual] reviewer approves",
		]);
	});
});

describe("interpretContract — specRef fallback", () => {
	it("falls back to contract:<id> when deliverable has no specRef", () => {
		const contract = {
			...t8Contract,
			deliverables: [
				{
					id: "D-no-spec",
					title: "No spec",
					acceptance: [{ kind: "tests" as const, assert: "ok" }],
					status: "pending" as const,
				},
			],
		};

		const result = interpretContract(contract, { now: new Date("2026-10-25T12:00:00Z") });

		expect(result.contracts[0].specRef).toBe("contract:dot-whatsapp-admin-api");
	});

	it("uses deliverable.specRef when present", () => {
		const contract = {
			...t8Contract,
			deliverables: [
				{
					id: "D-with-spec",
					title: "With spec",
					specRef: "odd/tasks/custom.md#S3",
					acceptance: [{ kind: "tests" as const, assert: "ok" }],
					status: "pending" as const,
				},
			],
		};

		const result = interpretContract(contract, { now: new Date("2026-10-25T12:00:00Z") });

		expect(result.contracts[0].specRef).toBe("odd/tasks/custom.md#S3");
	});
});

describe("interpretContract — gate evaluation", () => {
	it("passed gate keeps evidence in detail", () => {
		const result = interpretContract(t8Contract, { now: new Date("2026-10-25T12:00:00Z") });

		const g1 = result.gates.find((g) => g.id === "gate:G1");
		expect(g1).toBeDefined();
		expect(g1?.state).toBe("passed");
		expect(g1?.detail).toContain("externo ahora, hijo después");
	});

	it("open gate blocks progression with correct detail", () => {
		const contract = {
			...t8Contract,
			gates: [
				{ id: "G-open", kind: "user-decision" as const, appliesTo: "decision", state: "open" as const },
			],
			deliverables: [
				{ id: "D1", title: "Test", acceptance: [{ kind: "tests" as const, assert: "ok" }], status: "pending" as const },
			],
		};

		const result = interpretContract(contract, { now: new Date("2026-10-25T12:00:00Z") });

		const g = result.gates.find((g) => g.id === "gate:G-open");
		expect(g).toBeDefined();
		expect(g?.state).toBe("open");
		expect(g?.detail).toBe("gate open — blocks progression");
	});

	it("paused gate pauses with correct detail", () => {
		const result = interpretContract(t8Contract, { now: new Date("2026-10-25T12:00:00Z") });

		const g3 = result.gates.find((g) => g.id === "gate:G3");
		expect(g3).toBeDefined();
		expect(g3?.state).toBe("paused");
		expect(g3?.detail).toBe("gate paused");
	});

	it("includes all declared gates with gate: prefix", () => {
		const result = interpretContract(t8Contract, { now: new Date("2026-10-25T12:00:00Z") });

		expect(result.gates.map((g) => g.id).sort()).toEqual(["gate:G1", "gate:G2", "gate:G3", "gate:G4"]);
	});
});

describe("interpretContract — derived deadline gates", () => {
	it("hard deadline in future → open", () => {
		const contract = {
			...t8Contract,
			deadlines: { soft: null, hard: "2026-12-31T23:59:59Z" },
			deliverables: [
				{ id: "D1", title: "Test", acceptance: [{ kind: "tests" as const, assert: "ok" }], status: "pending" as const },
			],
		};

		const result = interpretContract(contract, { now: new Date("2026-10-25T12:00:00Z") });

		const hardGate = result.gates.find((g) => g.id === "deadline:hard");
		expect(hardGate).toBeDefined();
		expect(hardGate?.state).toBe("open");
		expect(hardGate?.detail).toContain("hard deadline not reached");
	});

	it("hard deadline in past → overdue", () => {
		const contract = {
			...t8Contract,
			deadlines: { soft: null, hard: "2026-10-01T00:00:00Z" },
			deliverables: [
				{ id: "D1", title: "Test", acceptance: [{ kind: "tests" as const, assert: "ok" }], status: "pending" as const },
			],
		};

		const result = interpretContract(contract, { now: new Date("2026-10-25T12:00:00Z") });

		const hardGate = result.gates.find((g) => g.id === "deadline:hard");
		expect(hardGate).toBeDefined();
		expect(hardGate?.state).toBe("overdue");
		expect(hardGate?.detail).toContain("2026-10-01");
		expect(hardGate?.detail).toContain("2026-10-25");
	});

	it("soft deadline in past → overdue", () => {
		const contract = {
			...t8Contract,
			deadlines: { soft: "2026-10-01T00:00:00Z", hard: null },
			deliverables: [
				{ id: "D1", title: "Test", acceptance: [{ kind: "tests" as const, assert: "ok" }], status: "pending" as const },
			],
		};

		const result = interpretContract(contract, { now: new Date("2026-10-25T12:00:00Z") });

		const softGate = result.gates.find((g) => g.id === "deadline:soft");
		expect(softGate).toBeDefined();
		expect(softGate?.state).toBe("overdue");
		expect(softGate?.detail).toContain("2026-10-01");
	});

	it("null deadlines produce no derived gates", () => {
		const result = interpretContract(t8Contract, { now: new Date("2026-10-25T12:00:00Z") });

		expect(result.gates.find((g) => g.id === "deadline:hard")).toBeUndefined();
		expect(result.gates.find((g) => g.id === "deadline:soft")).toBeUndefined();
	});

	it("malformed hard deadline → overdue with fail-closed detail (never throws)", () => {
		const contract = {
			...t8Contract,
			deadlines: { soft: null, hard: "not-a-date" },
			deliverables: [
				{ id: "D1", title: "Test", acceptance: [{ kind: "tests" as const, assert: "ok" }], status: "pending" as const },
			],
		};

		// Must not throw
		const result = interpretContract(contract, { now: new Date("2026-10-25T12:00:00Z") });

		const hardGate = result.gates.find((g) => g.id === "deadline:hard");
		expect(hardGate).toBeDefined();
		expect(hardGate?.state).toBe("overdue");
		expect(hardGate?.detail).toContain("malformed deadline");
		expect(hardGate?.detail).toContain("not-a-date");
		expect(hardGate?.detail).toContain("fail closed");
	});

	it("malformed soft deadline → overdue with fail-closed detail (never throws)", () => {
		const contract = {
			...t8Contract,
			deadlines: { soft: "invalid", hard: null },
			deliverables: [
				{ id: "D1", title: "Test", acceptance: [{ kind: "tests" as const, assert: "ok" }], status: "pending" as const },
			],
		};

		const result = interpretContract(contract, { now: new Date("2026-10-25T12:00:00Z") });

		const softGate = result.gates.find((g) => g.id === "deadline:soft");
		expect(softGate).toBeDefined();
		expect(softGate?.state).toBe("overdue");
		expect(softGate?.detail).toContain("malformed deadline");
		expect(softGate?.detail).toContain("invalid");
		expect(softGate?.detail).toContain("fail closed");
	});
});

describe("interpretContract — budget exposure", () => {
	it("returns the budget verbatim (limits and measured as stored)", () => {
		const contractWithBudget = {
			...t8Contract,
			budget: {
				modelCalls: { limit: 1000, measured: 42 },
				tokens: { limit: 50000, measured: 12345 },
				wallTime: { limit: 3600000, measured: 1800000 },
			},
			deliverables: [
				{ id: "D1", title: "Test", acceptance: [{ kind: "tests" as const, assert: "ok" }], status: "pending" as const },
			],
		};

		const result = interpretContract(contractWithBudget, { now: new Date("2026-10-25T12:00:00Z") });

		expect(result.budget).toEqual(contractWithBudget.budget);
	});

	it("T8 fixture budget (all null) exposed verbatim", () => {
		const result = interpretContract(t8Contract, { now: new Date("2026-10-25T12:00:00Z") });

		expect(result.budget).toEqual(t8Contract.budget);
	});
});

describe("interpretContract — scope clauses surfaced", () => {
	it("returns scope clauses verbatim for the router", () => {
		const result = interpretContract(t8Contract, { now: new Date("2026-10-25T12:00:00Z") });

		expect(result.scopeClauses).toEqual(t8Contract.scopeClauses);
	});
});

describe("interpretContract — determinism", () => {
	it("same contract + same now → deep-equal results", () => {
		const now = new Date("2026-10-25T12:00:00Z");
		const r1 = interpretContract(t8Contract, { now });
		const r2 = interpretContract(t8Contract, { now });

		expect(r1).toEqual(r2);
	});

	it("generatedAt is the injected clock as ISO string", () => {
		const now = new Date("2026-10-25T12:00:00Z");
		const result = interpretContract(t8Contract, { now });

		expect(result.generatedAt).toBe("2026-10-25T12:00:00.000Z");
	});
});

describe("interpretContract — zero pending deliverables", () => {
	it("returns empty contracts array and all skipped when all deliverables are delivered", () => {
		const contract = {
			...t8Contract,
			deliverables: [
				{ id: "D1", title: "Done", acceptance: [{ kind: "tests" as const, assert: "ok" }], status: "delivered" as const },
				{ id: "D2", title: "Also done", acceptance: [{ kind: "tests" as const, assert: "ok" }], status: "delivered" as const },
			],
		};

		const result = interpretContract(contract, { now: new Date("2026-10-25T12:00:00Z") });

		expect(result.contracts).toHaveLength(0);
		expect(result.skipped).toHaveLength(2);
		expect(result.skipped.every((s) => s.status === "delivered")).toBe(true);
	});

	it("returns empty contracts array and all skipped when all deliverables are blocked", () => {
		const contract = {
			...t8Contract,
			deliverables: [
				{ id: "D1", title: "Blocked", acceptance: [{ kind: "tests" as const, assert: "ok" }], status: "blocked" as const },
				{ id: "D2", title: "Also blocked", acceptance: [{ kind: "tests" as const, assert: "ok" }], status: "blocked" as const },
			],
		};

		const result = interpretContract(contract, { now: new Date("2026-10-25T12:00:00Z") });

		expect(result.contracts).toHaveLength(0);
		expect(result.skipped).toHaveLength(2);
		expect(result.skipped.every((s) => s.status === "blocked")).toBe(true);
	});

	it("mixed delivered/blocked/pending → only pending becomes TaskContract", () => {
		const contract = {
			...t8Contract,
			deliverables: [
				{ id: "D-delivered", title: "Done", acceptance: [{ kind: "tests" as const, assert: "ok" }], status: "delivered" as const },
				{ id: "D-blocked", title: "Stuck", acceptance: [{ kind: "tests" as const, assert: "ok" }], status: "blocked" as const },
				{ id: "D-pending", title: "Active", acceptance: [{ kind: "tests" as const, assert: "ok" }], status: "pending" as const },
			],
		};

		const result = interpretContract(contract, { now: new Date("2026-10-25T12:00:00Z") });

		expect(result.contracts).toHaveLength(1);
		expect(result.contracts[0].id).toBe("dot-whatsapp-admin-api-D-pending");
		expect(result.skipped).toHaveLength(2);
		const skippedIds = result.skipped.map((s) => s.deliverableId).sort();
		expect(skippedIds).toEqual(["D-blocked", "D-delivered"]);
	});
});

describe("interpretContract — TaskContract structure", () => {
	it("TaskContract has all required fields with correct defaults", () => {
		const contract = {
			...t8Contract,
			deliverables: [
				{
					id: "D1",
					title: "Task",
					acceptance: [{ kind: "tests" as const, assert: "ok" }],
					status: "pending" as const,
				},
			],
		};

		const now = new Date("2026-10-25T12:00:00Z");
		const result = interpretContract(contract, { now });

		const tc = result.contracts[0];
		expect(tc.id).toBe("dot-whatsapp-admin-api-D1");
		expect(tc.objective).toBe("Task");
		expect(tc.role).toBe("implementer");
		expect(tc.scope).toEqual([]);
		expect(tc.acceptanceCriteria).toEqual(["[tests] ok"]);
		expect(tc.specRef).toBe("contract:dot-whatsapp-admin-api");
		expect(tc.artifacts).toEqual([]);
		expect(tc.status).toBe("pending");
		expect(tc.version).toBe(1);
		expect(tc.history).toHaveLength(1);
		expect(tc.history[0]).toEqual({
			status: "pending",
			version: 1,
			nodeId: "contract-interpreter",
			timestamp: "2026-10-25T12:00:00.000Z",
		});
		expect(tc.retryCount).toBe(0);
		expect(tc.leaseFence).toBeUndefined();
		expect(tc.workerNodeId).toBeUndefined();
	});
});