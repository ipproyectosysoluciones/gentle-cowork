// The contract store (slice 6.1): one versioned, atomically-written file per
// project in the blackboard folder (.gentle-cowork/contract.json). Fail closed
// on load — a corrupt or unknown-version contract never starts execution —
// and optimistic version counting for amendments, with a changelog per version.
import { mkdtempSync, existsSync, statSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContractMigrationError, ContractValidationError } from "./schema.ts";
import { ContractVersionConflict, openContractStore } from "./store.ts";
import { t8Contract } from "./fixtures.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "gc-contract-"));
	dirs.push(dir);
	return join(dir, ".gentle-cowork", "contract.json");
}

describe("contract store — draft and load", () => {
	it("opens an empty store when no file exists, then drafts version 1", () => {
		const path = freshPath();
		const store = openContractStore(path);
		expect(store.get()).toBeUndefined();
		expect(store.version()).toBe(0);

		store.draft(t8Contract, "initial draft of the retrospective T8 contract");
		expect(store.version()).toBe(1);
		expect(store.get()?.contract.id).toBe("dot-whatsapp-admin-api");
		expect(store.get()?.changelog).toHaveLength(1);
		expect(store.get()?.changelog[0]?.version).toBe(1);
		expect(store.get()?.changelog[0]?.summary).toContain("T8");
		expect(existsSync(path)).toBe(true);
	});

	it("persists with mode 0600 and an atomic envelope that reopens identically", () => {
		const path = freshPath();
		const store = openContractStore(path);
		store.draft(t8Contract, "draft");

		const mode = statSync(path).mode & 0o777;
		expect(mode).toBe(0o600);

		const reopened = openContractStore(path);
		expect(reopened.get()?.contract).toEqual(t8Contract);
		expect(reopened.get()?.version).toBe(1);

		const envelope = JSON.parse(readFileSync(path, "utf8")) as { storeSchema: string; version: number };
		expect(envelope.storeSchema).toBe("gentle-cowork.contractstore/v1");
	});

	it("refuses to draft over an existing contract (amend instead)", () => {
		const path = freshPath();
		const store = openContractStore(path);
		store.draft(t8Contract, "draft");
		expect(() => store.draft(t8Contract, "again")).toThrow(/amend/);
	});
});

describe("contract store — amend with version counter and changelog", () => {
	it("amends to version N+1, appends the changelog, and applies the update", () => {
		const path = freshPath();
		const store = openContractStore(path);
		store.draft(t8Contract, "draft");

		const amended = store.amend("mark D1 delivered", (draft) => ({
			...draft,
			deliverables: draft.deliverables.map((d) => (d.id === "D1" ? { ...d, status: "delivered" as const } : d)),
		}));
		expect(amended.version).toBe(2);
		expect(store.version()).toBe(2);
		expect(store.get()?.contract.deliverables[0]?.status).toBe("delivered");
		expect(store.get()?.changelog).toHaveLength(2);
		expect(store.get()?.changelog[1]?.summary).toBe("mark D1 delivered");

		// The amendment survives a reopen (atomic write, not just memory).
		expect(openContractStore(path).get()?.changelog).toHaveLength(2);
	});

	it("rejects a stale expected version instead of silently overwriting", () => {
		const path = freshPath();
		const store = openContractStore(path);
		store.draft(t8Contract, "draft");
		store.amend("first amendment", (draft) => draft, 1);

		try {
			store.amend("second amendment", (draft) => draft, 1); // stale: disk is at 2
			expect.unreachable("stale version must throw");
		} catch (error) {
			expect(error).toBeInstanceOf(ContractVersionConflict);
		}
		// The file still holds version 2 and the failed amendment left no trace.
		expect(openContractStore(path).version()).toBe(2);
		expect(openContractStore(path).get()?.changelog).toHaveLength(2);
	});
});

describe("contract store — fail closed on load", () => {
	it("throws ContractValidationError on a corrupt file", () => {
		const path = freshPath();
		openContractStore(path).draft(t8Contract, "draft");
		writeFileSync(path, "{ not json", { mode: 0o600 });
		expect(() => openContractStore(path)).toThrow(ContractValidationError);
	});

	it("throws ContractMigrationError on an unknown schema version", () => {
		const path = freshPath();
		const store = openContractStore(path);
		store.draft(t8Contract, "draft");
		const envelope = JSON.parse(readFileSync(path, "utf8")) as { contract: { schema: string } };
		envelope.contract.schema = "gentle-cowork.projectcontract/v99";
		writeFileSync(path, JSON.stringify(envelope), { mode: 0o600 });
		expect(() => openContractStore(path)).toThrow(ContractMigrationError);
	});

	it("throws ContractValidationError when the file holds a structurally invalid contract", () => {
		const path = freshPath();
		const store = openContractStore(path);
		store.draft(t8Contract, "draft");
		const envelope = JSON.parse(readFileSync(path, "utf8")) as { contract: Record<string, unknown> };
		delete envelope.contract.gates;
		writeFileSync(path, JSON.stringify(envelope), { mode: 0o600 });
		expect(() => openContractStore(path)).toThrow(ContractValidationError);
	});
});
