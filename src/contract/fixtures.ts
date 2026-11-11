/**
 * Shared fixtures for the contract module tests. The foundational example is
 * the retrospective T8 contract (the dot-whatsapp admin API) exactly as it
 * shipped: real acceptance, real cost, real gates.
 */
import type { ProjectContract } from "./schema.ts";

export const t8Contract: ProjectContract = {
	schema: "gentle-cowork.projectcontract/v1",
	id: "dot-whatsapp-admin-api",
	title: "Admin API local para el panel Channels (T8)",
	objective: "Que el panel Channels de gentle-dot opere el bridge sin shell",
	branch: "main",
	deliverables: [
		{
			id: "D1",
			title: "Admin API según S6 (status/allowlist/pair/verify/unpair)",
			specRef: "odd/tasks/dot-whatsapp.md#S6",
			acceptance: [
				{ kind: "tests", assert: "51/51 green; 29 pre-existing unmodified" },
				{ kind: "typecheck", assert: "tsc --noEmit clean" },
				{ kind: "e2e-live", assert: "GET /status + /allowlist + circuito WS responden" },
			],
			status: "delivered",
		},
	],
	scopeClauses: [
		{ id: "SC1", rule: "Additive-only: el relay Baileys queda behaviorally idéntico", enforcement: "existing-tests-unmodified" },
		{ id: "SC2", rule: "El número completo nunca cruza el daemon ni la UI (últimos 4)", enforcement: "contract-tests" },
	],
	deadlines: { soft: null, hard: null },
	qualityMetrics: [
		{ metric: "test-count", target: ">= 51", measured: 51 },
		{ metric: "typecheck", target: "clean", measured: "clean" },
	],
	budget: {
		modelCalls: { limit: null, measured: null },
		tokens: { limit: null, measured: null },
		wallTime: { limit: null, measured: null },
	},
	gates: [
		{ id: "G1", kind: "user-decision", appliesTo: "arquitectura", state: "passed", evidence: "'externo ahora, hijo después' (2026-10-23)" },
		{ id: "G2", kind: "slice-boundary", appliesTo: "~400 líneas", state: "passed", evidence: "boundary registrado en L6 del doc hermano" },
		{ id: "G3", kind: "native-review", appliesTo: "unidad T8", state: "paused", evidence: "lineage review-b9b28abce22be44e; provider storm" },
		{ id: "G4", kind: "publish", appliesTo: "push/PR", state: "passed", evidence: "push + PR por orden del dueño" },
	],
	meta: {
		commits: ["ac95a26", "67e82ca", "45b8f26"],
		reviewLineage: "review-b9b28abce22be44e",
		issueRef: "gentle-dot#65",
	},
};
