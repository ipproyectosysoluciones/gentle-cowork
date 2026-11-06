// The contract store (slice 6.1): one versioned, atomically-written file per
// project in the blackboard folder (.gentle-cowork/contract.json). Fail closed
// on load — a corrupt or unknown-version contract never starts execution —
// and optimistic version counting for amendments, with a changelog per version.
import { mkdirSync, mkdtempSync, existsSync, readdirSync, statSync, readFileSync, symlinkSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
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

	it("never steals the lock of a holder that is alive but slow", () => {
		const path = freshPath();
		const store = openContractStore(path, { lockTimeoutMs: 60 });
		store.draft(t8Contract, "draft");

		// A live writer holds the lock while a slow update runs: the file looks
		// old, but the process is alive, so it must not be displaced by age.
		const held = `${process.pid}:live-slow-holder\n`;
		writeFileSync(`${path}.lock`, held, { mode: 0o600 });
		const old = new Date(Date.now() - 10 * 60_000);
		utimesSync(`${path}.lock`, old, old);
		try {
			expect(() => store.amend("must not steal", (draft) => draft, 1)).toThrow(ContractStoreBusyError);
			expect(readFileSync(`${path}.lock`, "utf8")).toBe(held);
		} finally {
			rmSync(`${path}.lock`, { force: true });
		}
		expect(openContractStore(path).version()).toBe(1);
	});

	it("never steals the lock of a live holder in a different process", () => {
		const path = freshPath();
		const store = openContractStore(path, { lockTimeoutMs: 60 });
		store.draft(t8Contract, "draft");

		// The holder is genuinely alive and is NOT this process, so the
		// `pid === process.pid` shortcut cannot answer for it: only the real
		// liveness probe keeps the lock in place.
		const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { stdio: "ignore" });
		try {
			const childPid = child.pid;
			if (childPid === undefined) throw new Error("the child process did not start");
			const held = `${childPid}:live-foreign-holder\n`;
			writeFileSync(`${path}.lock`, held, { mode: 0o600 });

			expect(() => store.amend("must not steal", (draft) => draft, 1)).toThrow(ContractStoreBusyError);
			expect(readFileSync(`${path}.lock`, "utf8")).toBe(held);
		} finally {
			child.kill();
			rmSync(`${path}.lock`, { force: true });
		}
		expect(openContractStore(path).version()).toBe(1);
	});

	it("holds a lock whose owner is unreadable while it is younger than the grace window", () => {
		const path = freshPath();
		const store = openContractStore(path, { lockTimeoutMs: 60 });
		store.draft(t8Contract, "draft");

		// A writer killed between openSync("wx") and its owner write leaves a
		// 0-byte lock. Its owner cannot be liveness-checked, so a fresh one may
		// still be a writer about to write its pid: it is never displaced by age.
		writeFileSync(`${path}.lock`, "", { mode: 0o600 });
		try {
			expect(() => store.amend("first attempt", (draft) => draft, 1)).toThrow(ContractStoreBusyError);
			expect(() => store.amend("second attempt", (draft) => draft, 1)).toThrow(ContractStoreBusyError);
			expect(existsSync(`${path}.lock`)).toBe(true);
		} finally {
			rmSync(`${path}.lock`, { force: true });
		}
		expect(openContractStore(path).version()).toBe(1);
	});

	it("reclaims an unreadable lock older than the grace window", () => {
		const path = freshPath();
		const store = openContractStore(path, { lockTimeoutMs: 500 });
		store.draft(t8Contract, "draft");

		// An abandoned 0-byte lock: nobody is alive to prove it wrong, but it has
		// outlived every plausible write, so the next writer self-heals instead
		// of failing forever with ContractStoreBusyError.
		writeFileSync(`${path}.lock`, "", { mode: 0o600 });
		const stale = new Date(Date.now() - 10 * 60_000);
		utimesSync(`${path}.lock`, stale, stale);

		expect(store.amend("after the unreadable lock", (draft) => draft, 1).version).toBe(2);
		expect(existsSync(`${path}.lock`)).toBe(false);
		expect(openContractStore(path).version()).toBe(2);
	});

	it("reclaims a garbled lock older than the grace window", () => {
		const path = freshPath();
		const store = openContractStore(path, { lockTimeoutMs: 500 });
		store.draft(t8Contract, "draft");

		// Same self-heal, different corruption shape: the owner text is present
		// but carries no pid, so age is again the only available evidence.
		writeFileSync(`${path}.lock`, "not-a-pid", { mode: 0o600 });
		const stale = new Date(Date.now() - 10 * 60_000);
		utimesSync(`${path}.lock`, stale, stale);

		expect(store.amend("after the garbled lock", (draft) => draft, 1).version).toBe(2);
		expect(existsSync(`${path}.lock`)).toBe(false);
		expect(openContractStore(path).version()).toBe(2);
	});

	it("reclaims the lock of a holder whose process is gone", () => {
		const path = freshPath();
		const store = openContractStore(path, { lockTimeoutMs: 500 });
		store.draft(t8Contract, "draft");

		// A writer died holding the lock: its pid is provably gone, so the next
		// writer of this host reclaims it instead of waiting for a timeout.
		const dead = spawnSync(process.execPath, ["-e", "0"]);
		writeFileSync(`${path}.lock`, `${dead.pid}:died\n`, { mode: 0o600 });

		expect(store.amend("after the crash", (draft) => draft, 1).version).toBe(2);
		expect(existsSync(`${path}.lock`)).toBe(false);
	});

	it("never displaces the lock another writer created during the reclaim (#65)", () => {
		const path = freshPath();
		const dead = spawnSync(process.execPath, ["-e", "0"]);
		const dir = `${path}.lock`;
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		writeFileSync(join(dir, "owner"), `${dead.pid}:died\n`, { mode: 0o600 });

		// The reclaim decides the owner is dead, and only then does a second reclaimer
		// win the race and publish a fresh owner of its own.
		const fresh = `${process.pid}:fresh-holder\n`;
		const store = openContractStore(path, {
			lockTimeoutMs: 60,
			beforeStaleLockSteal: () => writeFileSync(join(dir, "owner"), fresh, { mode: 0o600 }),
		});

		expect(() => store.draft(t8Contract, "draft")).toThrow(ContractStoreBusyError);
		// The fresh holder's lock is back byte for byte, and no dispute file is left.
		expect(readFileSync(join(dir, "owner"), "utf8")).toBe(fresh);
		expect(readdirSync(dir).filter((name) => name.startsWith("taken-"))).toEqual([]);
		rmSync(dir, { recursive: true, force: true });
	});

	// A reclaimer that died between parking an owner and putting it back leaves the
	// evidence on disk; the next writer finishes the job instead of starting over.
	it("puts a displaced live owner back after a reclaimer crashed", () => {
		const path = freshPath();
		const dead = spawnSync(process.execPath, ["-e", "0"]);
		const dir = `${path}.lock`;
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		writeFileSync(join(dir, "taken-1"), `${process.pid}:live-holder\n`, { mode: 0o600 });
		writeFileSync(join(dir, "owner"), `${dead.pid}:died\n`, { mode: 0o600 });

		const store = openContractStore(path, { lockTimeoutMs: 60 });
		expect(() => store.draft(t8Contract, "draft")).toThrow(ContractStoreBusyError);
		// The live holder is back under the canonical name and nothing was left parked.
		expect(readFileSync(join(dir, "owner"), "utf8")).toBe(`${process.pid}:live-holder\n`);
		expect(readdirSync(dir).filter((name) => name.startsWith("taken-"))).toEqual([]);
		rmSync(dir, { recursive: true, force: true });
	});

	it("reclaims a container whose owner never got written, only after the grace", () => {
		const path = freshPath();
		const dir = `${path}.lock`;
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		const stale = new Date(Date.now() - 10 * 60_000);
		utimesSync(dir, stale, stale);

		// No owner, no dispute evidence, old enough that no writer can still be inside
		// the window where it created the container and had not published itself.
		const store = openContractStore(path, { lockTimeoutMs: 500 });
		store.draft(t8Contract, "draft after an abandoned container");
		expect(store.version()).toBe(1);
		expect(existsSync(dir)).toBe(false); // released, not leaked
	});

	// The verifier's deterministic reproduction of the window that survived #65
	// (issue #69): A compares S, B removes it, C installs its own lock and enters
	// the critical section, A displaces C's lock, and D acquires what looks like a
	// free path. If the reclaim ever leaves the path momentarily acquirable, C and
	// D are both inside one critical section — the silent lost update #65 named.
	it("never lets a third writer in while a reclaim is in flight (#69)", () => {
		const path = freshPath();
		const dead = spawnSync(process.execPath, ["-e", "0"]);
		const dir = `${path}.lock`;
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		writeFileSync(join(dir, "owner"), `${dead.pid}:died\n`, { mode: 0o600 });

		const liveHolder = `${process.pid}:live-holder\n`;
		let third: unknown;
		const store = openContractStore(path, {
			lockTimeoutMs: 60,
			// C publishes its lock after the reclaim judged the stale one dead.
			beforeStaleLockSteal: () => writeFileSync(join(dir, "owner"), liveHolder, { mode: 0o600 }),
			// D probes exactly while C's lock is off the canonical name.
			beforeStaleLockRestore: () => {
				const probe = openContractStore(path, { lockTimeoutMs: 60 });
				try {
					third = probe.draft(t8Contract, "third writer");
				} catch (error) {
					third = error;
				}
			},
		});

		expect(() => store.draft(t8Contract, "reclaimer")).toThrow(ContractStoreBusyError);
		expect(third).toBeInstanceOf(ContractStoreBusyError);
		// The third writer never entered: the store is still unwritten.
		expect(openContractStore(path).version()).toBe(0);
		rmSync(dir, { recursive: true, force: true });
	});

	it("does not release a lock another writer took over", () => {
		const path = freshPath();
		const dir = `${path}.lock`;
		const writer = openContractStore(path);
		writer.draft(t8Contract, "draft");

		writer.amend(
			"amendment that loses its lock",
			(draft) => {
				// A takeover while this writer is inside its critical section.
				writeFileSync(join(dir, "owner"), `${process.pid}:thief\n`, { mode: 0o600 });
				return draft;
			},
			1,
		);

		// Releasing is ownership-checked: the new holder's owner survives untouched.
		expect(readFileSync(join(dir, "owner"), "utf8")).toBe(`${process.pid}:thief\n`);
		rmSync(dir, { recursive: true, force: true });
	});

	// Review W1: a writer that stalled past the grace window sees its owner publish
	// fail (the container was reclaimed and republished meanwhile). Cleaning that up
	// by deleting the owner would put a second writer inside the live holder's
	// critical section — the silent lost update this protocol exists to prevent.
	it("never frees a container another writer published into when its own publish fails", () => {
		const path = freshPath();
		const dir = `${path}.lock`;
		const foreign = `${process.pid}:foreign-holder\n`;
		const store = openContractStore(path, {
			lockTimeoutMs: 60,
			beforeLockOwnerPublish: () => {
				mkdirSync(dir, { recursive: true, mode: 0o700 });
				writeFileSync(join(dir, "owner"), foreign, { mode: 0o600 });
			},
		});

		expect(() => store.draft(t8Contract, "draft")).toThrow();
		// The foreign holder's lock and container survive this writer's cleanup.
		expect(readFileSync(join(dir, "owner"), "utf8")).toBe(foreign);
		rmSync(dir, { recursive: true, force: true });
	});

	// Review W2: the abandoned container is judged empty from a snapshot that another
	// settler invalidates by freeing it and a fresh writer taking it. Retiring by
	// rmdir refuses, instead of deleting the new holder's owner by path.
	it("never retires a container a fresh holder took after the empty one was judged stale", () => {
		const path = freshPath();
		const dir = `${path}.lock`;
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		const stale = new Date(Date.now() - 10 * 60_000);
		utimesSync(dir, stale, stale);
		const fresh = `${process.pid}:fresh-holder\n`;
		const store = openContractStore(path, {
			lockTimeoutMs: 60,
			beforeEmptyContainerRetire: () => {
				rmSync(dir, { recursive: true, force: true });
				mkdirSync(dir, { recursive: true, mode: 0o700 });
				writeFileSync(join(dir, "owner"), fresh, { mode: 0o600 });
			},
		});

		expect(() => store.draft(t8Contract, "draft")).toThrow(ContractStoreBusyError);
		expect(readFileSync(join(dir, "owner"), "utf8")).toBe(fresh);
		rmSync(dir, { recursive: true, force: true });
	});

	// Review W3: a dispute file whose content cannot be read used to be invisible to
	// the settle pass, so the container could never be freed. Its age is the evidence.
	it("clears a dispute file whose content cannot be read once the grace has passed", () => {
		const path = freshPath();
		const dir = `${path}.lock`;
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		symlinkSync("/nonexistent-target", join(dir, "taken-ghost"));
		const stale = new Date(Date.now() - 10 * 60_000);
		utimesSync(dir, stale, stale);

		const store = openContractStore(path, { lockTimeoutMs: 1_000 });
		store.draft(t8Contract, "draft after a ghost dispute");
		expect(store.version()).toBe(1);
		expect(existsSync(dir)).toBe(false);
	});

	it("frees its own container after a successful write", () => {
		const path = freshPath();
		openContractStore(path).draft(t8Contract, "draft");
		expect(existsSync(`${path}.lock`)).toBe(false);
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
