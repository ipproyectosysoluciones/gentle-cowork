// The contract store (slice 6.1): one versioned, atomically-written file per
// project in the blackboard folder (.gentle-cowork/contract.json). Fail closed
// on load — a corrupt or unknown-version contract never starts execution —
// and optimistic version counting for amendments, with a changelog per version.
import { mkdirSync, mkdtempSync, existsSync, statSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContractMigrationError, ContractValidationError } from "./schema.ts";
import { ContractStoreBusyError, ContractVersionConflict, openContractStore } from "./store.ts";
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

describe("contract store — changelog validation on load", () => {
	const corrupt = (mutate: (envelope: Record<string, unknown>) => void): string => {
		const path = freshPath();
		openContractStore(path).draft(t8Contract, "draft");
		const envelope = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		mutate(envelope);
		writeFileSync(path, JSON.stringify(envelope), { mode: 0o600 });
		return path;
	};

	it("throws ContractValidationError when a changelog entry is not an object", () => {
		const path = corrupt((envelope) => {
			envelope.changelog = [null];
		});
		expect(() => openContractStore(path)).toThrow(ContractValidationError);
	});

	it("throws ContractValidationError when an entry lacks a summary", () => {
		const path = corrupt((envelope) => {
			envelope.changelog = [{ version: 1, at: new Date().toISOString() }];
		});
		expect(() => openContractStore(path)).toThrow(ContractValidationError);
	});

	it("throws ContractValidationError when an entry version is not a positive integer", () => {
		const path = corrupt((envelope) => {
			envelope.changelog = [{ version: 0, at: new Date().toISOString(), summary: "draft" }];
		});
		expect(() => openContractStore(path)).toThrow(ContractValidationError);
	});

	it("throws ContractValidationError when the last entry disagrees with the envelope version", () => {
		const path = corrupt((envelope) => {
			envelope.changelog = [{ version: 7, at: new Date().toISOString(), summary: "draft" }];
		});
		expect(() => openContractStore(path)).toThrow(ContractValidationError);
	});

	it("throws ContractValidationError when entry versions are not 1..N", () => {
		const path = corrupt((envelope) => {
			envelope.version = 2;
			envelope.changelog = [
				{ version: 2, at: new Date().toISOString(), summary: "skipped a version" },
				{ version: 2, at: new Date().toISOString(), summary: "duplicate version" },
			];
		});
		expect(() => openContractStore(path)).toThrow(ContractValidationError);
	});

	it("throws ContractValidationError on an empty changelog for a persisted version", () => {
		const path = corrupt((envelope) => {
			envelope.changelog = [];
		});
		expect(() => openContractStore(path)).toThrow(ContractValidationError);
	});

	it("still loads every shape the store itself writes", () => {
		const path = freshPath();
		const store = openContractStore(path);
		store.draft(t8Contract, "draft");
		store.amend("first amendment", (draft) => draft, 1);
		expect(openContractStore(path).get()?.changelog.map((entry) => entry.version)).toEqual([1, 2]);
	});
});

describe("contract store — cross-process write discipline", () => {
	it("refuses to draft while another process holds the store lock", () => {
		const path = freshPath();
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		const store = openContractStore(path, { lockTimeoutMs: 50 });

		// A foreign writer holds the documented lock file while it writes.
		writeFileSync(`${path}.lock`, "other-process\n", { mode: 0o600 });
		try {
			expect(() => store.draft(t8Contract, "draft under a held lock")).toThrow(ContractStoreBusyError);
		} finally {
			rmSync(`${path}.lock`, { force: true });
		}
		// The blocked draft left no trace, and the store drafts once released.
		expect(existsSync(path)).toBe(false);
		expect(openContractStore(path).version()).toBe(0);
		expect(store.draft(t8Contract, "draft after release").version).toBe(1);
	});

	it("refuses to amend while another process holds the store lock", () => {
		const path = freshPath();
		const store = openContractStore(path, { lockTimeoutMs: 50 });
		store.draft(t8Contract, "draft");

		writeFileSync(`${path}.lock`, "other-process\n", { mode: 0o600 });
		try {
			expect(() => store.amend("blocked amendment", (draft) => draft, 1)).toThrow(ContractStoreBusyError);
		} finally {
			rmSync(`${path}.lock`, { force: true });
		}
		// The blocked amendment left no trace, and the store still works after.
		expect(openContractStore(path).version()).toBe(1);
		expect(openContractStore(path).get()?.changelog).toHaveLength(1);
		expect(store.amend("after release", (draft) => draft, 1).version).toBe(2);
	});

	it("fails a writer interleaved inside the update instead of losing it silently", () => {
		const path = freshPath();
		const writer = openContractStore(path);
		const interleaved = openContractStore(path, { lockTimeoutMs: 50 });
		writer.draft(t8Contract, "draft");

		let interleaveError: unknown;
		writer.amend(
			"first amendment",
			(draft) => {
				try {
					interleaved.amend("interleaved amendment", (d) => d, 1);
				} catch (error) {
					interleaveError = error;
				}
				return draft;
			},
			1,
		);

		// The interleaved writer is told it lost; it is never silently discarded
		// after reporting success.
		expect(interleaveError).toBeInstanceOf(ContractStoreBusyError);
		const reopened = openContractStore(path);
		expect(reopened.version()).toBe(2);
		expect(reopened.get()?.changelog.map((entry) => entry.summary)).toEqual(["draft", "first amendment"]);
	});

	it("does not delete a lock another writer took over", () => {
		const path = freshPath();
		const writer = openContractStore(path);
		writer.draft(t8Contract, "draft");

		writer.amend(
			"amendment that loses its lock",
			(draft) => {
				// A takeover while this writer is inside its critical section.
				rmSync(`${path}.lock`, { force: true });
				writeFileSync(`${path}.lock`, `${process.pid}:thief\n`, { mode: 0o600 });
				return draft;
			},
			1,
		);

		// Releasing must be ownership-checked: the new holder's lock survives.
		expect(readFileSync(`${path}.lock`, "utf8")).toBe(`${process.pid}:thief\n`);
		rmSync(`${path}.lock`, { force: true });
	});

	it("releases the lock when the update throws", () => {
		const path = freshPath();
		const store = openContractStore(path, { lockTimeoutMs: 50 });
		store.draft(t8Contract, "draft");

		expect(() =>
			store.amend(
				"boom",
				() => {
					throw new Error("update exploded");
				},
				1,
			),
		).toThrow(/update exploded/);
		// The failed amendment stored nothing and did not leave the lock behind.
		expect(openContractStore(path).version()).toBe(1);
		expect(store.amend("recovered", (draft) => draft, 1).version).toBe(2);
	});
});

describe("contract store — changelog validation on load", () => {
	const corrupt = (mutate: (envelope: Record<string, unknown>) => void): string => {
		const path = freshPath();
		openContractStore(path).draft(t8Contract, "draft");
		const envelope = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		mutate(envelope);
		writeFileSync(path, JSON.stringify(envelope), { mode: 0o600 });
		return path;
	};

	it("throws ContractValidationError when a changelog entry is not an object", () => {
		const path = corrupt((envelope) => {
			envelope.changelog = [null];
		});
		expect(() => openContractStore(path)).toThrow(ContractValidationError);
	});

	it("throws ContractValidationError when an entry lacks a summary", () => {
		const path = corrupt((envelope) => {
			envelope.changelog = [{ version: 1, at: new Date().toISOString() }];
		});
		expect(() => openContractStore(path)).toThrow(ContractValidationError);
	});

	it("throws ContractValidationError when an entry version is not a positive integer", () => {
		const path = corrupt((envelope) => {
			envelope.changelog = [{ version: 0, at: new Date().toISOString(), summary: "draft" }];
		});
		expect(() => openContractStore(path)).toThrow(ContractValidationError);
	});

	it("throws ContractValidationError when the last entry disagrees with the envelope version", () => {
		const path = corrupt((envelope) => {
			envelope.changelog = [{ version: 7, at: new Date().toISOString(), summary: "draft" }];
		});
		expect(() => openContractStore(path)).toThrow(ContractValidationError);
	});

	it("throws ContractValidationError when entry versions are not 1..N", () => {
		const path = corrupt((envelope) => {
			envelope.version = 2;
			envelope.changelog = [
				{ version: 2, at: new Date().toISOString(), summary: "skipped a version" },
				{ version: 2, at: new Date().toISOString(), summary: "duplicate version" },
			];
		});
		expect(() => openContractStore(path)).toThrow(ContractValidationError);
	});

	it("throws ContractValidationError on an empty changelog for a persisted version", () => {
		const path = corrupt((envelope) => {
			envelope.changelog = [];
		});
		expect(() => openContractStore(path)).toThrow(ContractValidationError);
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
