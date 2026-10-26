// ProjectContract schema (slice 6.1): fail-closed validation, closed enums, and
// versioned migration. The foundational fixture is the retrospective T8 contract
// (dot-whatsapp admin API) with the real acceptance, cost, and gates it lived.
import { describe, expect, it } from "vitest";
import {
	ContractMigrationError,
	ContractValidationError,
	PROJECT_CONTRACT_SCHEMA,
	migrateProjectContract,
	validateProjectContract,
} from "./schema.ts";
import { t8Contract } from "./fixtures.ts";

describe("ProjectContract schema validation", () => {
	it("accepts the retrospective T8 contract", () => {
		const parsed = validateProjectContract(t8Contract);
		expect(parsed.id).toBe("dot-whatsapp-admin-api");
		expect(parsed.deliverables[0]?.acceptance).toHaveLength(3);
		expect(parsed.gates).toHaveLength(4);
	});

	it("rejects non-object values and reports the root path", () => {
		try {
			validateProjectContract("nope");
			expect.unreachable("must throw");
		} catch (error) {
			expect(error).toBeInstanceOf(ContractValidationError);
			expect((error as ContractValidationError).issues.some((i) => i.includes("root"))).toBe(true);
		}
	});

	it("rejects a wrong schema name (fail closed on identity)", () => {
		const wrong = { ...t8Contract, schema: "some.other/v1" };
		expect(() => validateProjectContract(wrong)).toThrow(ContractValidationError);
	});

	it("rejects missing id, title, objective, and branch", () => {
		for (const field of ["id", "title", "objective", "branch"] as const) {
			const broken: Record<string, unknown> = { ...t8Contract };
			delete broken[field];
			try {
				validateProjectContract(broken);
				expect.unreachable(`${field} must be required`);
			} catch (error) {
				expect((error as ContractValidationError).issues.some((i) => i.includes(field))).toBe(true);
			}
		}
	});

	it("rejects empty deliverables and a deliverable with no acceptance criteria", () => {
		expect(() => validateProjectContract({ ...t8Contract, deliverables: [] })).toThrow(ContractValidationError);
		const noAcceptance = {
			...t8Contract,
			deliverables: [{ ...t8Contract.deliverables[0], acceptance: [] }],
		};
		expect(() => validateProjectContract(noAcceptance)).toThrow(ContractValidationError);
	});

	it("keeps the acceptance-kind enum closed", () => {
		const bad = {
			...t8Contract,
			deliverables: [
				{
					...t8Contract.deliverables[0],
					acceptance: [{ kind: "vibes", assert: "looks right" }],
				},
			],
		};
		try {
			validateProjectContract(bad);
			expect.unreachable("unknown acceptance kind must throw");
		} catch (error) {
			const issues = (error as ContractValidationError).issues.join(" ");
			expect(issues).toContain("acceptance");
		}
	});

	it("keeps the gate-kind and gate-state enums closed", () => {
		const badGate = { ...t8Contract, gates: [{ ...t8Contract.gates[0], kind: "vibes" }] };
		expect(() => validateProjectContract(badGate)).toThrow(ContractValidationError);
		const badState = { ...t8Contract, gates: [{ ...t8Contract.gates[0], state: "skipped" }] };
		expect(() => validateProjectContract(badState)).toThrow(ContractValidationError);
	});

	it("rejects a deliverable status outside the enum", () => {
		const bad = { ...t8Contract, deliverables: [{ ...t8Contract.deliverables[0], status: "maybe" }] };
		expect(() => validateProjectContract(bad)).toThrow(ContractValidationError);
	});

	it("rejects a budget without the three declared limits", () => {
		const bad = { ...t8Contract, budget: { modelCalls: { limit: null, measured: null } } };
		expect(() => validateProjectContract(bad)).toThrow(ContractValidationError);
	});

	it("rejects duplicate deliverable, clause, and gate ids", () => {
		const dupDeliverable = {
			...t8Contract,
			deliverables: [t8Contract.deliverables[0], { ...t8Contract.deliverables[0], title: "dup" }],
		};
		expect(() => validateProjectContract(dupDeliverable)).toThrow(ContractValidationError);
		const dupGate = { ...t8Contract, gates: [t8Contract.gates[0], { ...t8Contract.gates[0], appliesTo: "x" }] };
		expect(() => validateProjectContract(dupGate)).toThrow(ContractValidationError);
	});
});

describe("ProjectContract migration", () => {
	it("passes a current v1 contract through unchanged", () => {
		const migrated = migrateProjectContract(t8Contract);
		expect(migrated).toEqual(t8Contract);
	});

	it("fails closed on an unknown schema version (no migration registered)", () => {
		const future = { ...t8Contract, schema: "gentle-cowork.projectcontract/v99" };
		try {
			migrateProjectContract(future);
			expect.unreachable("unknown version must throw");
		} catch (error) {
			expect(error).toBeInstanceOf(ContractMigrationError);
		}
	});

	it("fails closed on an unparseable schema string", () => {
		expect(() => migrateProjectContract({ ...t8Contract, schema: "garbage" })).toThrow(ContractMigrationError);
	});

	it("exposes the canonical schema name", () => {
		expect(PROJECT_CONTRACT_SCHEMA).toBe("gentle-cowork.projectcontract");
	});
});
