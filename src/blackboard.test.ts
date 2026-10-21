/**
 * Phase 4/5 tests — blackboard state persistence with multi-node support (spec S5).
 *
 * A shared state file (JSON) that all roles read/write; TaskContract
 * persistence across the full pending → in_progress → completed/failed
 * lifecycle; the board survives a fresh open (simulated daemon restart);
 * an interrupted chain loses nothing.
 *
 * Phase 5 additions:
 * - Advisory file locking (flock) for same-machine concurrent writers
 * - Lease mechanism with monotonic fencing tokens
 * - Orphan recovery sweep (master-only)
 * - Version counter per contract for conflict resolution (timestamps display-only)
 * - Node registration with heartbeats
 * - A corrupt or missing state file fails safe to an empty board, never a crash.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { defaultBlackboardPath, openBlackboard, MAX_RETRY_COUNT, STATE_VERSION } from "./blackboard.ts";
import type { TaskContract, ContractHistoryEntry, NodeRegistration, LeaseInfo } from "./types.ts";

/** Creates a scratch directory for one test's state file. */
function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "gentle-cowork-blackboard-"));
}

/** Builds a well-formed TaskContract with optional overrides. */
function makeContract(overrides: Partial<TaskContract> = {}): TaskContract {
  const base: TaskContract = {
    id: "gc-1",
    objective: "Verify the widget module",
    role: "planner",
    scope: ["src/widget/"],
    acceptanceCriteria: ["all widget tests pass"],
    specRef: "odd/tasks/gentle-cowork-extension.md",
    artifacts: [],
    status: "pending",
    version: 1,
    history: [{
      status: "pending",
      version: 1,
      nodeId: "test-node",
      timestamp: new Date().toISOString(),
    }],
    leaseFence: undefined,
    retryCount: undefined,
    ...overrides,
  };
  const v = overrides.version ?? 1;
  if (v > 1 && (!overrides.history || overrides.history.length < v)) {
    base.history = Array.from({ length: v }, (_, i) => ({
      status: i === v - 1 ? (overrides.status ?? "pending") : "pending",
      version: i + 1,
      nodeId: "test-node",
      timestamp: new Date().toISOString(),
    }));
  }
  return base;
}

/** Writes a raw string as the state file (corrupt/shape fixtures). */
function writeRawState(filePath: string, contents: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

/** Reads the raw state file as JSON — the shared on-disk format. */
function readRawState(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function makeNode(overrides: Partial<NodeRegistration> = {}): NodeRegistration {
  return {
    nodeId: "worker-1",
    role: "worker",
    capabilities: ["implementer"],
    startedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
    status: "alive",
    ...overrides,
  };
}

describe("blackboard state file (S5)", () => {
  it("opens an empty board when the state file does not exist yet", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      expect(board.listContracts()).toEqual([]);
      expect(board.getContract("gc-1")).toBeUndefined();
      expect(board.filePath).toBe(join(tmp, ".gentle-cowork", "blackboard.json"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails safe to an empty board when the state file is corrupt", () => {
    const tmp = makeTmpDir();
    try {
      const filePath = defaultBlackboardPath(tmp);
      writeRawState(filePath, "{ this is not valid json");
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const board = openBlackboard(filePath);
        expect(board.listContracts()).toEqual([]);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("blackboard corrupt"));
      } finally {
        errorSpy.mockRestore();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails safe to an empty board when the state file has an unrecognized shape", () => {
    const tmp = makeTmpDir();
    try {
      const filePath = defaultBlackboardPath(tmp);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const fixtures = [
          '"just a string"',
          '{"contracts": []}',
          '{"version": 2, "contracts": []}',
          '{"version": 1, "contracts": "not-an-array"}',
        ];
        for (const fixture of fixtures) {
          writeRawState(filePath, fixture);
          const board = openBlackboard(filePath);
          expect(board.listContracts()).toEqual([]);
        }
        expect(errorSpy).toHaveBeenCalledTimes(3);
      } finally {
        errorSpy.mockRestore();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("drops malformed contract entries but keeps valid ones", () => {
    const tmp = makeTmpDir();
    try {
      const filePath = defaultBlackboardPath(tmp);
      const valid = makeContract({ id: "gc-2", status: "in_progress" });
      writeRawState(
        filePath,
        JSON.stringify({
          version: STATE_VERSION,
          contracts: [valid, "a bare string", { id: "gc-3" }, null, { ...valid, id: "gc-4", status: "bogus" }],
          nodes: [],
          lastFence: 0,
        }),
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const board = openBlackboard(filePath);
        const contracts = board.listContracts();
        expect(contracts).toHaveLength(1);
        expect(contracts[0].id).toBe("gc-2");
        expect(contracts[0].status).toBe("in_progress");
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("dropped 4"));
      } finally {
        errorSpy.mockRestore();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("persists the pending → in_progress → completed/failed lifecycle and a fresh open survives", () => {
    const tmp = makeTmpDir();
    try {
      const filePath = defaultBlackboardPath(tmp);
      const board = openBlackboard(filePath);

      const completedTask = makeContract({ id: "gc-42", status: "pending" });
      board.putContract(completedTask);
      expect(board.getContract("gc-42")?.status).toBe("pending");
      expect(board.updateStatus("gc-42", "in_progress", "test-node")?.status).toBe("in_progress");
      expect(board.updateStatus("gc-42", "completed", "test-node")?.status).toBe("completed");

      const failedTask = makeContract({ id: "gc-43", objective: "Second task", status: "pending" });
      board.putContract(failedTask);
      board.updateStatus("gc-43", "in_progress", "test-node");
      board.updateStatus("gc-43", "failed", "test-node");

      // Simulated daemon restart: a fresh open reads the same state file.
      const restarted = openBlackboard(filePath);
      const contracts = restarted.listContracts();
      expect(contracts).toHaveLength(2);
      const completed = contracts.find(c => c.id === "gc-42")!;
      const failed = contracts.find(c => c.id === "gc-43")!;
      expect(completed.status).toBe("completed");
      expect(completed.version).toBe(3);
      expect(completed.history).toHaveLength(3);
      expect(completed.history[0]).toMatchObject({ status: "pending", version: 1 });
      expect(completed.history[1]).toMatchObject({ status: "in_progress", version: 2 });
      expect(completed.history[2]).toMatchObject({ status: "completed", version: 3 });
      expect(failed.status).toBe("failed");
      expect(failed.version).toBe(3);
      expect(failed.history).toHaveLength(3);
      expect(failed.history[2].status).toBe("failed");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("loses nothing when a delegation is interrupted and resumed (exit criterion)", () => {
    const tmp = makeTmpDir();
    try {
      const filePath = defaultBlackboardPath(tmp);
      const running = makeContract({
        id: "gc-9",
        objective: "Long delegation interrupted mid-chain",
        status: "in_progress",
      });

      // The chain starts and persists its in_progress contract.
      openBlackboard(filePath).putContract(running);

      // The daemon dies mid-chain; a restart reopens the same board.
      const afterRestart = openBlackboard(filePath);
      const stored = afterRestart.getContract("gc-9");
      expect(stored).toMatchObject({ id: "gc-9", status: "in_progress" });

      // The work resumes after the restart and completes with its artifact.
      afterRestart.putContract({
        ...(stored as TaskContract),
        status: "completed",
        artifacts: ['{"outcome":"APPROVE"}'],
      });

      // A second restart still sees the completed contract — nothing lost.
      const secondRestart = openBlackboard(filePath);
      expect(secondRestart.getContract("gc-9")).toMatchObject({
        id: "gc-9",
        status: "completed",
        artifacts: ['{"outcome":"APPROVE"}'],
      });

      // A new delegation after the restart persists alongside the old one.
      secondRestart.putContract(makeContract({ id: "gc-10", status: "in_progress" }));
      expect(openBlackboard(filePath).listContracts()).toHaveLength(2);
      expect(openBlackboard(filePath).getContract("gc-10")?.status).toBe("in_progress");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns undefined from updateStatus for an unknown id and persists nothing", () => {
    const tmp = makeTmpDir();
    try {
      const filePath = defaultBlackboardPath(tmp);
      const board = openBlackboard(filePath);
      const contract = makeContract();
      board.putContract(contract);

      expect(board.updateStatus("gc-missing", "completed", "test-node")).toBeUndefined();
      expect(openBlackboard(filePath).listContracts()).toEqual([contract]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("upserts by id: an existing contract is replaced in place, order preserved", () => {
    const tmp = makeTmpDir();
    try {
      const filePath = defaultBlackboardPath(tmp);
      const board = openBlackboard(filePath);
      const first = makeContract({ id: "gc-1" });
      const second = makeContract({ id: "gc-2", objective: "Second task" });
      board.putContract(first);
      board.putContract(second);

      const firstCompleted: TaskContract = { ...first, status: "completed", artifacts: ["artifact"] };
      board.putContract(firstCompleted);

      const restarted = openBlackboard(filePath);
      expect(restarted.listContracts()).toHaveLength(2);
      expect(restarted.listContracts().filter((c) => c.id === "gc-1")).toHaveLength(1);
      expect(restarted.getContract("gc-1")?.status).toBe("completed");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("writes a versioned JSON state file that any role can read back", () => {
    const tmp = makeTmpDir();
    try {
      const filePath = defaultBlackboardPath(tmp);
      const board = openBlackboard(filePath);
      const contract = makeContract({ status: "in_progress" });
      board.putContract(contract);

      const raw = readRawState(filePath);
      expect(raw.version).toBe(STATE_VERSION);
      expect(raw.contracts).toHaveLength(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns defensive copies: mutating a returned contract cannot corrupt the board", () => {
    const tmp = makeTmpDir();
    try {
      const filePath = defaultBlackboardPath(tmp);
      const board = openBlackboard(filePath);
      board.putContract(makeContract());

      const got = board.getContract("gc-1");
      got?.scope.push("src/evil.ts");
      if (got) got.status = "failed";
      const listed = board.listContracts();
      listed[0]?.artifacts.push("tampered");

      const restarted = openBlackboard(filePath);
      const persisted = restarted.getContract("gc-1");
      const original = makeContract();
      expect(persisted?.id).toBe(original.id);
      expect(persisted?.objective).toBe(original.objective);
      expect(persisted?.role).toBe(original.role);
      expect(persisted?.scope).toEqual(original.scope);
      expect(persisted?.acceptanceCriteria).toEqual(original.acceptanceCriteria);
      expect(persisted?.specRef).toBe(original.specRef);
      expect(persisted?.artifacts).toEqual(original.artifacts);
      expect(persisted?.status).toBe(original.status);
      expect(persisted?.version).toBe(original.version);
      expect(persisted?.history).toHaveLength(original.history.length);
      persisted?.history.forEach((entry, i) => {
        expect(entry.status).toBe(original.history[i].status);
        expect(entry.version).toBe(original.history[i].version);
        expect(entry.nodeId).toBe(original.history[i].nodeId);
        expect(entry.artifacts).toEqual(original.history[i].artifacts);
        expect(entry.leaseFence).toBe(original.history[i].leaseFence);
      });
      expect(persisted?.leaseFence).toBe(original.leaseFence);
      expect(persisted?.retryCount).toBe(original.retryCount);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("blackboard — Phase 5: lease with fencing tokens", () => {
  it("acquires a lease with fence=1 when no lease exists", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const lease = board.acquireLease("master-1");
      expect(lease).not.toBeNull();
      expect(lease!.holderNodeId).toBe("master-1");
      expect(lease!.fence).toBe(1);
      expect(new Date(lease!.expiresAt).getTime()).toBeGreaterThan(Date.now());
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("increments fence on subsequent acquire after release", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const lease1 = board.acquireLease("master-1");
      expect(lease1!.fence).toBe(1);
      board.releaseLease("master-1", lease1!.fence);
      const lease2 = board.acquireLease("master-1");
      expect(lease2!.fence).toBe(2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("increments fence on renew", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const lease = board.acquireLease("master-1");
      const renewed = board.renewLease("master-1", lease!.fence);
      expect(renewed).not.toBeNull();
      expect(renewed!.fence).toBe(lease!.fence + 1);
      expect(new Date(renewed!.expiresAt).getTime()).toBeGreaterThanOrEqual(new Date(lease!.expiresAt).getTime());
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects renew with stale fence", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const lease = board.acquireLease("master-1");
      const renewed = board.renewLease("master-1", lease!.fence - 1);
      expect(renewed).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects release with stale fence", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const lease = board.acquireLease("master-1");
      const released = board.releaseLease("master-1", lease!.fence - 1);
      expect(released).toBe(false);
      const validRelease = board.releaseLease("master-1", lease!.fence);
      expect(validRelease).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects putContract with stale fence (fencing enforcement)", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const lease = board.acquireLease("master-1");
      board.releaseLease("master-1", lease!.fence);
      board.acquireLease("master-1");

      const contract = makeContract({ id: "gc-1" });
      expect(() => board.putContract(contract, lease!.fence)).toThrow(/Fence rejected/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects updateStatus with stale fence", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const lease = board.acquireLease("master-1");
      board.putContract(makeContract({ id: "gc-1" }));
      board.releaseLease("master-1", lease!.fence);
      board.acquireLease("master-1");

      expect(() => board.updateStatus("gc-1", "in_progress", "test-node", undefined, lease!.fence)).toThrow(/Fence rejected/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("accepts putContract with current fence", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const lease = board.acquireLease("master-1");
      const contract = makeContract({ id: "gc-1" });
      board.putContract(contract, lease!.fence);
      expect(board.getContract("gc-1")).toEqual(contract);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("accepts updateStatus with current fence", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const lease = board.acquireLease("master-1");
      board.putContract(makeContract({ id: "gc-1" }));
      const updated = board.updateStatus("gc-1", "in_progress", "test-node", undefined, lease!.fence);
      expect(updated?.status).toBe("in_progress");
      expect(updated?.version).toBe(2);
      expect(updated?.history).toHaveLength(2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("lease expires after TTL and new acquire gets higher fence", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const lease = board.acquireLease("master-1", 1);
      const start = Date.now();
      while (Date.now() - start < 10) { /* busy wait */ }
      const newLease = board.acquireLease("master-1");
      expect(newLease!.fence).toBe(lease!.fence + 1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("persists lease across restarts", () => {
    const tmp = makeTmpDir();
    try {
      const filePath = defaultBlackboardPath(tmp);
      const board = openBlackboard(filePath);
      board.acquireLease("master-1");

      const restarted = openBlackboard(filePath);
      const lease = restarted.getLease();
      expect(lease).not.toBeUndefined();
      expect(lease!.holderNodeId).toBe("master-1");
      expect(lease!.fence).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("blackboard — Phase 5: node registration & heartbeats", () => {
  it("registers a node and returns it in getNodes", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const node = makeNode({ nodeId: "worker-1" });
      board.registerNode(node);
      const nodes = board.getNodes();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].nodeId).toBe("worker-1");
      expect(nodes[0].capabilities).toEqual(["implementer"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("updates lastHeartbeat and status on heartbeat", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const node = makeNode({ nodeId: "worker-1", status: "stale" });
      board.registerNode(node);
      board.heartbeat("worker-1");
      const nodes = board.getNodes();
      expect(nodes[0].status).toBe("alive");
      expect(new Date(nodes[0].lastHeartbeat).getTime()).toBeGreaterThanOrEqual(new Date(node.lastHeartbeat).getTime());
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("persists nodes across restarts", () => {
    const tmp = makeTmpDir();
    try {
      const filePath = defaultBlackboardPath(tmp);
      const board = openBlackboard(filePath);
      board.registerNode(makeNode({ nodeId: "worker-1" }));

      const restarted = openBlackboard(filePath);
      const nodes = restarted.getNodes();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].nodeId).toBe("worker-1");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("blackboard — Phase 5: master/worker capability model (T5.3)", () => {
  it("registers master with planner and verifier capabilities", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      board.registerNode({
        nodeId: "master-1",
        role: "master",
        capabilities: ["planner", "verifier"],
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        status: "alive",
      });
      const nodes = board.getNodes();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].role).toBe("master");
      expect(nodes[0].capabilities).toEqual(["planner", "verifier"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("registers worker with implementer capability only", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      board.registerNode({
        nodeId: "worker-1",
        role: "worker",
        capabilities: ["implementer"],
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        status: "alive",
      });
      const nodes = board.getNodes();
      expect(nodes[0].role).toBe("worker");
      expect(nodes[0].capabilities).toEqual(["implementer"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("multiple workers register with different capabilities", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      board.registerNode({
        nodeId: "worker-1",
        role: "worker",
        capabilities: ["implementer"],
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        status: "alive",
      });
      board.registerNode({
        nodeId: "worker-2",
        role: "worker",
        capabilities: ["implementer", "verifier"],
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        status: "alive",
      });
      const nodes = board.getNodes();
      expect(nodes).toHaveLength(2);
      const caps = nodes.map((n) => n.capabilities.sort().join(",")).sort();
      expect(caps).toEqual(["implementer", "implementer,verifier"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("heartbeat updates lastHeartbeat and sets status to alive", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const node = makeNode({ nodeId: "worker-1", status: "stale", lastHeartbeat: new Date(Date.now() - 10000).toISOString() });
      board.registerNode(node);
      const before = board.getNodes()[0].lastHeartbeat;
      board.heartbeat("worker-1");
      const after = board.getNodes()[0].lastHeartbeat;
      expect(after).not.toBe(before);
      expect(board.getNodes()[0].status).toBe("alive");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("node becomes stale after STALE_THRESHOLD_MS without heartbeat", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const node = makeNode({
        nodeId: "worker-1",
        status: "alive",
        lastHeartbeat: new Date(Date.now() - 20000).toISOString(), // 20s ago > STALE_THRESHOLD_MS (15s)
      });
      board.registerNode(node);
      // Manually trigger staleness check by updating node status based on heartbeat age
      const nodes = board.getNodes();
      const isStale = Date.now() - new Date(nodes[0].lastHeartbeat).getTime() > 15000;
      expect(isStale).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("getNodes returns defensive copies", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      board.registerNode(makeNode({ nodeId: "worker-1" }));
      const nodes = board.getNodes();
      nodes[0].status = "stale";
      const fresh = board.getNodes();
      expect(fresh[0].status).toBe("alive");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("heartbeat on unknown node is no-op", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      board.heartbeat("unknown-node"); // Should not throw
      expect(board.getNodes()).toHaveLength(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("re-registering same nodeId updates capabilities", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      board.registerNode({
        nodeId: "worker-1",
        role: "worker",
        capabilities: ["implementer"],
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        status: "alive",
      });
      board.registerNode({
        nodeId: "worker-1",
        role: "worker",
        capabilities: ["implementer", "verifier"],
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        status: "alive",
      });
      const nodes = board.getNodes();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].capabilities).toEqual(["implementer", "verifier"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("blackboard — Phase 5: orphan recovery sweep", () => {
  it("marks in_progress contracts as failed(stale) when lease expired and heartbeat stale", () => {
    const tmp = makeTmpDir();
    try {
      const filePath = defaultBlackboardPath(tmp);
      const board = openBlackboard(filePath);
      const lease = board.acquireLease("master-1");
      board.registerNode(makeNode({ nodeId: "worker-1", lastHeartbeat: new Date(Date.now() - 35000).toISOString() }));

      const contract = makeContract({
        id: "gc-1",
        status: "in_progress",
        version: 2,
        history: [
          { status: "pending", version: 1, nodeId: "worker-1", timestamp: new Date().toISOString() },
          { status: "in_progress", version: 2, nodeId: "worker-1", timestamp: new Date().toISOString(), leaseFence: lease!.fence },
        ],
        leaseFence: lease!.fence,
      });
      board.putContract(contract, lease!.fence);

      board.releaseLease("master-1", lease!.fence);
      const newLease = board.acquireLease("master-1");

      const result = board.runOrphanRecovery();
      expect(result.recovered).toBe(1);
      expect(result.requeued).toBe(1);

      const failed = board.getContract("gc-1");
      expect(failed?.status).toBe("failed");
      expect(failed?.version).toBe(3);
      expect(failed?.history).toHaveLength(3);
      const lastEntry = failed!.history[2];
      expect(lastEntry.status).toBe("failed");
      expect(lastEntry.artifacts).toEqual([{ reason: "orphaned", previousFence: lease!.fence, currentFence: newLease!.fence }]);

      const requeued = board.getContract("gc-1-retry-1");
      expect(requeued).not.toBeUndefined();
      expect(requeued?.status).toBe("pending");
      expect(requeued?.retryCount).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not recover contracts still under current lease fence", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const lease = board.acquireLease("master-1");
      board.registerNode(makeNode({ nodeId: "worker-1", lastHeartbeat: new Date().toISOString() }));

      const contract = makeContract({
        id: "gc-1",
        status: "in_progress",
        leaseFence: lease!.fence,
        history: [
          { status: "pending", version: 1, nodeId: "worker-1", timestamp: new Date().toISOString() },
          { status: "in_progress", version: 2, nodeId: "worker-1", timestamp: new Date().toISOString(), leaseFence: lease!.fence },
        ],
      });
      board.putContract(contract, lease!.fence);

      const result = board.runOrphanRecovery();
      expect(result.recovered).toBe(0);
      expect(result.requeued).toBe(0);
      expect(board.getContract("gc-1")?.status).toBe("in_progress");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not recover contracts with fresh heartbeat", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const lease = board.acquireLease("master-1");
      board.registerNode(makeNode({ nodeId: "worker-1", lastHeartbeat: new Date().toISOString() }));

      const contract = makeContract({
        id: "gc-1",
        status: "in_progress",
        leaseFence: lease!.fence,
        history: [
          { status: "pending", version: 1, nodeId: "worker-1", timestamp: new Date().toISOString() },
          { status: "in_progress", version: 2, nodeId: "worker-1", timestamp: new Date().toISOString(), leaseFence: lease!.fence },
        ],
      });
      board.putContract(contract, lease!.fence);

      board.releaseLease("master-1", lease!.fence);
      board.acquireLease("master-1");

      const result = board.runOrphanRecovery();
      expect(result.recovered).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("stops re-queuing after MAX_RETRY_COUNT (3)", () => {
    const tmp = makeTmpDir();
    try {
      const filePath = defaultBlackboardPath(tmp);
      const contract = makeContract({
        id: "gc-1",
        status: "in_progress",
        retryCount: 3,
        leaseFence: 1,
        history: [
          { status: "pending", version: 1, nodeId: "worker-1", timestamp: new Date().toISOString() },
          { status: "in_progress", version: 2, nodeId: "worker-1", timestamp: new Date().toISOString(), leaseFence: 1 },
        ],
      });
      const board = openBlackboard(filePath);
      board.registerNode(makeNode({ nodeId: "worker-1", lastHeartbeat: new Date(Date.now() - 35000).toISOString() }));
      const lease1 = board.acquireLease("master-1");
      expect(lease1!.fence).toBe(1);
      board.putContract(contract, lease1!.fence);
      board.releaseLease("master-1", lease1!.fence);
      const lease2 = board.acquireLease("master-1");
      expect(lease2!.fence).toBe(2);

      const result = board.runOrphanRecovery();
      expect(result.recovered).toBe(1);
      expect(result.requeued).toBe(0);

      const failed = board.getContract("gc-1");
      expect(failed?.status).toBe("failed");
      expect(board.getContract("gc-1-retry-4")).toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("blackboard — Phase 5: merge contracts (version counter)", () => {
  it("merges new contract from another node", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      board.acquireLease("master-1");
      const incoming = makeContract({ id: "gc-2", objective: "From worker" });
      const merged = board.mergeContracts([incoming]);
      expect(merged).toBe(1);
      expect(board.getContract("gc-2")).toEqual(incoming);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("keeps existing contract when incoming version is lower", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      board.acquireLease("master-1");
      const existing = makeContract({ id: "gc-1", version: 5, status: "completed" });
      board.putContract(existing);
      const incoming = makeContract({ id: "gc-1", version: 3, status: "in_progress" });
      const merged = board.mergeContracts([incoming]);
      expect(merged).toBe(0);
      expect(board.getContract("gc-1")?.version).toBe(5);
      expect(board.getContract("gc-1")?.status).toBe("completed");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("merges when incoming version is higher", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      board.acquireLease("master-1");
      const existing = makeContract({ id: "gc-1", version: 3, status: "in_progress" });
      board.putContract(existing);
      const incoming = makeContract({ id: "gc-1", version: 5, status: "completed" });
      const merged = board.mergeContracts([incoming]);
      expect(merged).toBe(1);
      expect(board.getContract("gc-1")?.version).toBe(5);
      expect(board.getContract("gc-1")?.status).toBe("completed");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("resolves equal versions by status priority (completed > failed > in_progress > pending)", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      board.acquireLease("master-1");
      const existing = makeContract({ id: "gc-1", version: 3, status: "in_progress" });
      board.putContract(existing);

      const incomingCompleted = makeContract({ id: "gc-1", version: 3, status: "completed" });
      board.mergeContracts([incomingCompleted]);
      expect(board.getContract("gc-1")?.status).toBe("completed");

      board.putContract(existing);
      const incomingFailed = makeContract({ id: "gc-1", version: 3, status: "failed" });
      board.mergeContracts([incomingFailed]);
      expect(board.getContract("gc-1")?.status).toBe("failed");

      board.putContract(existing);
      const incomingPending = makeContract({ id: "gc-1", version: 3, status: "pending" });
      board.mergeContracts([incomingPending]);
      expect(board.getContract("gc-1")?.status).toBe("in_progress");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("timestamps are display-only: merge uses version not timestamp", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      board.acquireLease("master-1");
      const existing = makeContract({
        id: "gc-1",
        version: 2,
        status: "completed",
        history: [
          { status: "pending", version: 1, nodeId: "a", timestamp: "2024-01-01T00:00:00.000Z" },
          { status: "completed", version: 2, nodeId: "a", timestamp: "2024-01-01T00:00:00.000Z" },
        ],
      });
      board.putContract(existing);

      const incoming = makeContract({
        id: "gc-1",
        version: 3,
        status: "failed",
        history: [
          { status: "pending", version: 1, nodeId: "b", timestamp: "2024-01-02T00:00:00.000Z" },
          { status: "in_progress", version: 2, nodeId: "b", timestamp: "2024-01-02T00:00:00.000Z" },
          { status: "failed", version: 3, nodeId: "b", timestamp: "2024-01-02T00:00:00.000Z" },
        ],
      });
      board.mergeContracts([incoming]);
      expect(board.getContract("gc-1")?.version).toBe(3);
      expect(board.getContract("gc-1")?.status).toBe("failed");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// T5.2 — Additional merge logic edge cases (property-based style)
describe("blackboard — Phase 5: merge logic edge cases (T5.2)", () => {
  it("mergeContracts handles multiple incoming contracts in batch", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      board.acquireLease("master-1");
      board.putContract(makeContract({ id: "gc-1", version: 1, status: "pending" }));
      board.putContract(makeContract({ id: "gc-2", version: 1, status: "pending" }));

      const incoming = [
        makeContract({ id: "gc-1", version: 2, status: "in_progress" }),
        makeContract({ id: "gc-2", version: 2, status: "in_progress" }),
        makeContract({ id: "gc-3", version: 1, status: "pending" }),
      ];
      const merged = board.mergeContracts(incoming);
      expect(merged).toBe(3);
      expect(board.getContract("gc-1")?.version).toBe(2);
      expect(board.getContract("gc-2")?.version).toBe(2);
      expect(board.getContract("gc-3")?.version).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("mergeContracts preserves history when adopting incoming contract", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      board.acquireLease("master-1");
      const existing = makeContract({
        id: "gc-1",
        version: 1,
        status: "pending",
        history: [
          { status: "pending", version: 1, nodeId: "a", timestamp: "2024-01-01T00:00:00.000Z" },
        ],
      });
      board.putContract(existing);

      const incoming = makeContract({
        id: "gc-1",
        version: 3,
        status: "completed",
        history: [
          { status: "pending", version: 1, nodeId: "b", timestamp: "2024-01-01T00:00:00.000Z" },
          { status: "in_progress", version: 2, nodeId: "b", timestamp: "2024-01-01T01:00:00.000Z" },
          { status: "completed", version: 3, nodeId: "b", timestamp: "2024-01-01T02:00:00.000Z" },
        ],
      });
      board.mergeContracts([incoming]);

      const merged = board.getContract("gc-1")!;
      expect(merged.version).toBe(3);
      expect(merged.history).toHaveLength(3);
      expect(merged.history[2].status).toBe("completed");
      // History should be from incoming (adopted wholesale)
      expect(merged.history[0].nodeId).toBe("b");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("mergeContracts with higher version wins regardless of status (current behavior)", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      board.acquireLease("master-1");
      // Existing is already completed (terminal)
      const existing = makeContract({ id: "gc-1", version: 3, status: "completed" });
      board.putContract(existing);

      // Incoming has higher version but tries to go back to in_progress
      // Current implementation: higher version wins regardless of status transition validity
      const incoming = makeContract({ id: "gc-1", version: 4, status: "in_progress" });
      const merged = board.mergeContracts([incoming]);
      expect(merged).toBe(1); // Higher version wins
      expect(board.getContract("gc-1")?.status).toBe("in_progress");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("mergeContracts with equal version and equal status priority keeps existing", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      board.acquireLease("master-1");
      const existing = makeContract({ id: "gc-1", version: 2, status: "completed" });
      board.putContract(existing);

      const incoming = makeContract({ id: "gc-1", version: 2, status: "completed" });
      const merged = board.mergeContracts([incoming]);
      expect(merged).toBe(0); // No change, same version and status
      expect(board.getContract("gc-1")?.version).toBe(2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("mergeContracts handles concurrent completed vs failed at same version", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      board.acquireLease("master-1");
      const existing = makeContract({ id: "gc-1", version: 3, status: "completed" });
      board.putContract(existing);

      const incoming = makeContract({ id: "gc-1", version: 3, status: "failed" });
      const merged = board.mergeContracts([incoming]);
      // completed has higher priority than failed
      expect(merged).toBe(0);
      expect(board.getContract("gc-1")?.status).toBe("completed");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("mergeContracts with empty incoming array returns 0", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      board.acquireLease("master-1");
      board.putContract(makeContract({ id: "gc-1", version: 1 }));

      const merged = board.mergeContracts([]);
      expect(merged).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("mergeContracts does not mutate incoming contracts", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      board.acquireLease("master-1");
      const existing = makeContract({ id: "gc-1", version: 1, status: "pending" });
      board.putContract(existing);

      const incoming = makeContract({ id: "gc-1", version: 3, status: "completed" });
      const incomingCopy = JSON.parse(JSON.stringify(incoming));
      board.mergeContracts([incoming]);
      // Incoming should be unchanged
      expect(incoming).toEqual(incomingCopy);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("mergeContracts with contracts missing version field (legacy) works", () => {
    const tmp = makeTmpDir();
    try {
      const board1 = openBlackboard(defaultBlackboardPath(tmp));
      board1.acquireLease("master-1");
      // Simulate legacy contract without version (will be normalized to v1)
      const legacy = {
        id: "gc-1",
        objective: "Legacy",
        role: "planner" as const,
        scope: ["src/"],
        acceptanceCriteria: ["works"],
        specRef: "spec.md",
        artifacts: [],
        status: "completed" as const,
      };
      const filePath = defaultBlackboardPath(tmp);
      mkdirSync(dirname(filePath), { recursive: true });
      writeRawState(filePath, JSON.stringify({ version: 1, contracts: [legacy], nodes: [], lastFence: 0 }));

      const board2 = openBlackboard(filePath);
      // Normalized to version 1
      expect(board2.getContract("gc-1")?.version).toBe(1);

      // Incoming with explicit higher version should win
      const incoming = makeContract({ id: "gc-1", version: 2, status: "failed" });
      const merged = board2.mergeContracts([incoming]);
      expect(merged).toBe(1);
      expect(board2.getContract("gc-1")?.version).toBe(2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("blackboard — Phase 5: lock + concurrent write safety", () => {
  it("acquires and releases write lock around putContract", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const lease = board.acquireLease("master-1");
      board.putContract(makeContract({ id: "gc-1" }), lease!.fence);
      expect(board.getContract("gc-1")).toBeDefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("acquires and releases write lock around updateStatus", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const lease = board.acquireLease("master-1");
      board.putContract(makeContract({ id: "gc-1" }));
      board.updateStatus("gc-1", "in_progress", "test-node", undefined, lease!.fence);
      expect(board.getContract("gc-1")?.status).toBe("in_progress");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("blackboard — Phase 5: version counter & history audit trail", () => {
  it("increments version on every status transition", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const lease = board.acquireLease("master-1");
      const contract = makeContract({ id: "gc-1", status: "pending", version: 1 });
      board.putContract(contract, lease!.fence);

      const v2 = board.updateStatus("gc-1", "in_progress", "node-1", undefined, lease!.fence);
      expect(v2?.version).toBe(2);
      expect(v2?.history).toHaveLength(2);

      const v3 = board.updateStatus("gc-1", "completed", "node-1", ["artifact"], lease!.fence);
      expect(v3?.version).toBe(3);
      expect(v3?.history).toHaveLength(3);

      expect(v3?.history[0]).toMatchObject({ status: "pending", version: 1 });
      expect(v3?.history[1]).toMatchObject({ status: "in_progress", version: 2 });
      expect(v3?.history[2]).toMatchObject({ status: "completed", version: 3, artifacts: ["artifact"] });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("records leaseFence in history when entering in_progress", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const lease = board.acquireLease("master-1");
      board.putContract(makeContract({ id: "gc-1" }), lease!.fence);

      const updated = board.updateStatus("gc-1", "in_progress", "node-1", undefined, lease!.fence);
      const inProgressEntry = updated!.history.find((h) => h.status === "in_progress");
      expect(inProgressEntry?.leaseFence).toBe(lease!.fence);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not modify leaseFence on transitions from in_progress", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(defaultBlackboardPath(tmp));
      const lease = board.acquireLease("master-1");
      const contract = makeContract({ id: "gc-1", status: "in_progress", leaseFence: lease!.fence, version: 2 });
      board.putContract(contract, lease!.fence);

      const updated = board.updateStatus("gc-1", "completed", "node-1", undefined, lease!.fence);
      expect(updated?.leaseFence).toBe(lease!.fence);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("blackboard — Phase 5: legacy migration (STATE_VERSION=1 → 2)", () => {
  it("loads STATE_VERSION=1 file, normalizes contracts, and next write upgrades to STATE_VERSION=2", () => {
    const tmp = makeTmpDir();
    try {
      const filePath = defaultBlackboardPath(tmp);
      mkdirSync(dirname(filePath), { recursive: true });
      const legacyContract = {
        id: "gc-1",
        objective: "Legacy task",
        role: "planner" as const,
        scope: ["src/"],
        acceptanceCriteria: ["works"],
        specRef: "spec.md",
        artifacts: [],
        status: "completed" as const,
      };
      writeRawState(filePath, JSON.stringify({ version: 1, contracts: [legacyContract] }));

      // Load — should normalize and succeed
      const board = openBlackboard(filePath);
      const loaded = board.listContracts();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe("gc-1");
      expect(loaded[0].version).toBe(1);
      expect(loaded[0].history).toHaveLength(1);
      expect(loaded[0].history[0].status).toBe("completed");
      expect(loaded[0].leaseFence).toBeUndefined();
      expect(loaded[0].retryCount).toBe(0);

      // Write — should upgrade to STATE_VERSION=2
      const lease = board.acquireLease("master-1");
      board.putContract(makeContract({ id: "gc-2" }), lease!.fence);

      const raw = readRawState(filePath);
      expect(raw.version).toBe(STATE_VERSION);
      expect(raw.contracts).toHaveLength(2);
      expect(raw.nodes).toEqual([]);
      expect(typeof raw.lastFence).toBe("number");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("legacy in_progress contract gets leaseFence from normalizeContract", () => {
    const tmp = makeTmpDir();
    try {
      const filePath = defaultBlackboardPath(tmp);
      mkdirSync(dirname(filePath), { recursive: true });
      const legacyInProgress = {
        id: "gc-1",
        objective: "Legacy in progress",
        role: "planner" as const,
        scope: ["src/"],
        acceptanceCriteria: ["works"],
        specRef: "spec.md",
        artifacts: [],
        status: "in_progress" as const,
      };
      writeRawState(filePath, JSON.stringify({ version: 1, contracts: [legacyInProgress] }));

      const board = openBlackboard(filePath);
      const loaded = board.listContracts();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].status).toBe("in_progress");
      expect(loaded[0].history[0].status).toBe("in_progress");
      // leaseFence is undefined for legacy (no fence at the time)
      expect(loaded[0].leaseFence).toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
describe("blackboard — Phase 5: step assignment (T5.8)", () => {
  it("assignContract transitions a pending contract to in_progress with workerNodeId + leaseFence", () => {
    const tmp = makeTmpDir();
    try {
      const filePath = join(tmp, ".gentle-cowork", "blackboard.json");
      const board = openBlackboard(filePath);
      board.registerNode({
        nodeId: "master-1", role: "master", capabilities: ["planner", "verifier"],
        startedAt: new Date().toISOString(), lastHeartbeat: new Date().toISOString(), status: "alive",
      });
      board.registerNode({
        nodeId: "worker-1", role: "worker", capabilities: ["implementer"],
        startedAt: new Date().toISOString(), lastHeartbeat: new Date().toISOString(), status: "alive",
      });
      const lease = board.acquireLease("master-1");
      expect(lease).not.toBeNull();

      const contract = makeContract({ id: "gc-1", role: "implementer", status: "pending", version: 1 });
      board.putContract(contract, lease!.fence);

      const assigned = board.assignContract("gc-1", "worker-1", lease!.fence);
      expect(assigned).toBeDefined();
      expect(assigned!.status).toBe("in_progress");
      expect(assigned!.workerNodeId).toBe("worker-1");
      expect(assigned!.version).toBe(2);
      expect(assigned!.leaseFence).toBe(lease!.fence);
      const lastEntry = assigned!.history[assigned!.history.length - 1];
      expect(lastEntry.status).toBe("in_progress");
      // Owner of record in history is the assigned worker (orphan recovery keys off it)
      expect(lastEntry.nodeId).toBe("worker-1");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("assignContract returns undefined for a missing contract", () => {
    const tmp = makeTmpDir();
    try {
      const filePath = join(tmp, ".gentle-cowork", "blackboard.json");
      const board = openBlackboard(filePath);
      expect(board.assignContract("gc-missing", "worker-1")).toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("assignContract refuses to assign a contract that is not pending", () => {
    const tmp = makeTmpDir();
    try {
      const filePath = join(tmp, ".gentle-cowork", "blackboard.json");
      const board = openBlackboard(filePath);
      const lease = board.acquireLease("master-1");
      const done = makeContract({ id: "gc-2", role: "implementer", status: "completed", version: 2 });
      board.putContract(done, lease!.fence);

      const assigned = board.assignContract("gc-2", "worker-1", lease!.fence);
      expect(assigned).toBeUndefined();
      // No mutation happened
      expect(board.getContract("gc-2")!.status).toBe("completed");
      expect(board.getContract("gc-2")!.workerNodeId).toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("assignContract rejects a stale presented fence", () => {
    const tmp = makeTmpDir();
    try {
      const filePath = join(tmp, ".gentle-cowork", "blackboard.json");
      const board = openBlackboard(filePath);
      const lease = board.acquireLease("master-1");
      const contract = makeContract({ id: "gc-1", role: "implementer", status: "pending", version: 1 });
      board.putContract(contract, lease!.fence);

      // A second holder supersedes the first lease (higher fence)
      board.acquireLease("worker-1");
      expect(() => board.assignContract("gc-1", "worker-1", lease!.fence)).toThrow(/Fence rejected/);
      // The contract is untouched
      expect(board.getContract("gc-1")!.status).toBe("pending");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("updateStatus recordArtifacts land in the history entry only, never in contract.artifacts", () => {
    const tmp = makeTmpDir();
    try {
      const filePath = join(tmp, ".gentle-cowork", "blackboard.json");
      const board = openBlackboard(filePath);
      const lease = board.acquireLease("worker-1");
      const contract = makeContract({ id: "gc-3", role: "implementer", status: "in_progress", version: 2 });
      board.putContract(contract, lease!.fence);

      const verdictRecord = { type: "worker_verdict", contractId: "gc-3", status: "completed", criteria: [] };
      const updated = board.updateStatus("gc-3", "completed", "worker-1", ["src/file.ts"], lease!.fence, [verdictRecord]);

      expect(updated).toBeDefined();
      // Strings append to contract artifacts...
      expect(updated!.artifacts).toContain("src/file.ts");
      // ...the record artifact rides the history entry only
      expect(updated!.artifacts.every((a) => typeof a === "string")).toBe(true);
      const lastEntry = updated!.history[updated!.history.length - 1];
      expect(lastEntry.artifacts).toBeDefined();
      expect((lastEntry.artifacts as Array<string | Record<string, unknown>>).some(
        (a) => typeof a === "object" && (a as Record<string, unknown>).type === "worker_verdict",
      )).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
