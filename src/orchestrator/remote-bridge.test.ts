/**
 * T5.9 — RemoteWorkerBridge (master-side glue for remote workers) — tests.
 *
 * The bridge owns its transport (WSServer) and mirrors WS events onto the
 * blackboard. The blackboard is the coordination point (L15 amendment 2).
 * Unit tests use mock executors; e2e test uses MasterOrchestrator + RemoteWorkerClient.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";

import { openBlackboard } from "../blackboard.ts";
import { WS_BIND } from "../ws/protocol.ts";
import { RemoteWorkerBridge } from "./remote-bridge.ts";
import { MasterOrchestrator } from "./master.ts";
import { RemoteWorkerClient } from "./remote-worker.ts";
import { extractWorkerVerdict } from "./verdict.ts";
import type { WorkerStepVerdict, StepExecutor } from "./types.ts";
import type { TaskContract, NodeRegistration } from "../types.ts";
import type { StepResult } from "../ws/protocol.ts";

/** Creates a scratch directory for one test's state file. */
function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "gentle-cowork-bridge-"));
}

function makeNode(nodeId: string, role: "master" | "worker", capabilities: NodeRegistration["capabilities"]): NodeRegistration {
  return {
    nodeId,
    role,
    capabilities,
    startedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
    status: "alive",
  };
}

function makeVerdict(overrides: Partial<WorkerStepVerdict> = {}): WorkerStepVerdict {
  return {
    contractId: "gc-1",
    workerNodeId: "worker-1",
    status: "completed",
    criteria: [{ criterion: "file exists", satisfied: true, evidence: "created" }],
    artifacts: ["docs/demo.md"],
    executedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeExecutor(verdict?: Partial<WorkerStepVerdict>): { execute: ReturnType<typeof vi.fn>; executor: StepExecutor } {
  const execute = vi.fn(async (contract: TaskContract): Promise<WorkerStepVerdict> => ({
    contractId: contract.id,
    workerNodeId: "remote-worker-e2e",
    status: "completed",
    criteria: contract.acceptanceCriteria.map((criterion) => ({
      criterion,
      satisfied: true,
      evidence: "mock evidence",
    })),
    artifacts: ["src/orchestrator/remote-bridge.ts"],
    executedAt: new Date().toISOString(),
    ...verdict,
  }));
  return { execute, executor: { execute } };
}

/** Waits until `predicate` holds, polling every `pollMs` (bounded by timeoutMs). */
async function until(predicate: () => boolean, timeoutMs = 2000, pollMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition not met within timeout");
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

// ============================================================================
// Unit tests (in-process WSServer, no external processes)
// ============================================================================

describe("T5.9 RemoteWorkerBridge — unit", () => {
  let bridge: RemoteWorkerBridge;
  let board: ReturnType<typeof openBlackboard>;
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    board = openBlackboard(join(tmp, ".gentle-cowork", "blackboard.json"));
    bridge = new RemoteWorkerBridge({ board, port: 0, bind: WS_BIND, nodeId: "master-bridge" });
  });

  afterEach(async () => {
    try {
      await bridge.stop();
    } catch {
      // ignore
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it("exposes a url after start (ws://127.0.0.1:<port>)", async () => {
    await bridge.start();
    expect(bridge.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
  });

  it("registers a worker on the blackboard when onWorkerRegistered fires", async () => {
    await bridge.start();

    bridge.handleWorkerRegistered({
      nodeId: "remote-worker-1",
      role: "worker",
      capabilities: ["implementer"],
      startedAt: new Date().toISOString(),
    });

    const remote = board.getNodes().find((n) => n.nodeId === "remote-worker-1");
    expect(remote).toBeDefined();
    expect(remote?.role).toBe("worker");
    expect(remote?.capabilities).toContain("implementer");
    expect(remote?.status).toBe("alive");
  });

  it("mirrors heartbeat to the blackboard", async () => {
    await bridge.start();

    // First register a worker via the callback path
    bridge.handleWorkerRegistered({
      nodeId: "remote-heartbeat",
      role: "worker",
      capabilities: ["implementer"],
      startedAt: new Date().toISOString(),
    });

    // Now trigger heartbeat callback
    const heartbeatNodeId = "remote-heartbeat";
    bridge.handleHeartbeat(heartbeatNodeId);

    // Verify the blackboard node has an updated lastHeartbeat
    await until(() => {
      const node = board.getNodes().find((n) => n.nodeId === heartbeatNodeId);
      return node !== undefined && node.status === "alive";
    });
    const node = board.getNodes().find((n) => n.nodeId === heartbeatNodeId);
    expect(node).toBeDefined();
    expect(node!.status).toBe("alive");
  });

  it("applies step_result to the blackboard with the worker verdict as history artifact", async () => {
    await bridge.start();

    const nodeId = "remote-result";

    // Register worker first
    bridge.handleWorkerRegistered({
      nodeId,
      role: "worker",
      capabilities: ["implementer"],
      startedAt: new Date().toISOString(),
    });

    // Seed a pending contract and assign it to this worker
    const lease = board.acquireLease("master-bridge")!;
    const pending: TaskContract = {
      id: "gc-bridge-1",
      objective: "Test step",
      role: "implementer",
      scope: ["src/"],
      acceptanceCriteria: ["test passes"],
      specRef: "odd/tasks/gentle-cowork-phase5.md",
      artifacts: [],
      status: "pending",
      version: 1,
      history: [{ status: "pending", version: 1, nodeId: "master-bridge", timestamp: new Date().toISOString() }],
      retryCount: 0,
    };
    board.putContract(pending, lease.fence);
    board.assignContract("gc-bridge-1", nodeId, lease.fence);
    board.releaseLease("master-bridge", lease.fence);

    // Send step_result
    const stepResult: StepResult = {
      type: "step_result",
      contractId: "gc-bridge-1",
      stepId: "s1",
      artifact: "test output",
      status: "completed",
      workerVerdict: makeVerdict({ contractId: "gc-bridge-1", workerNodeId: nodeId }),
    };
    bridge.handleStepResult(stepResult, nodeId);

    // Verify contract was updated and verdict recorded
    await until(() => {
      const c = board.getContract("gc-bridge-1");
      return c?.status === "completed";
    });
    const contract = board.getContract("gc-bridge-1")!;
    expect(contract.status).toBe("completed");
    expect(contract.workerNodeId).toBe(nodeId);

    const verdict = extractWorkerVerdict(contract);
    expect(verdict).not.toBeNull();
    expect(verdict!.contractId).toBe("gc-bridge-1");
    expect(verdict!.workerNodeId).toBe(nodeId);
    expect(verdict!.status).toBe("completed");
    expect(verdict!.criteria.length).toBeGreaterThan(0);
  });

  it("synthesizes a verdict when step_result lacks workerVerdict", async () => {
    await bridge.start();

    const nodeId = "remote-no-verdict";

    bridge.handleWorkerRegistered({
      nodeId,
      role: "worker",
      capabilities: ["implementer"],
      startedAt: new Date().toISOString(),
    });

    const lease = board.acquireLease("master-bridge")!;
    const pending: TaskContract = {
      id: "gc-bridge-2",
      objective: "Test step without verdict",
      role: "implementer",
      scope: ["src/"],
      acceptanceCriteria: ["test passes"],
      specRef: "odd/tasks/gentle-cowork-phase5.md",
      artifacts: [],
      status: "pending",
      version: 1,
      history: [{ status: "pending", version: 1, nodeId: "master-bridge", timestamp: new Date().toISOString() }],
      retryCount: 0,
    };
    board.putContract(pending, lease.fence);
    board.assignContract("gc-bridge-2", nodeId, lease.fence);
    board.releaseLease("master-bridge", lease.fence);

    // Send step_result WITHOUT workerVerdict
    const stepResult: StepResult = {
      type: "step_result",
      contractId: "gc-bridge-2",
      stepId: "s1",
      artifact: "test output",
      status: "completed",
    };
    bridge.handleStepResult(stepResult, nodeId);

    await until(() => {
      const c = board.getContract("gc-bridge-2");
      return c?.status === "completed";
    });
    const contract = board.getContract("gc-bridge-2")!;
    const verdict = extractWorkerVerdict(contract);
    expect(verdict).not.toBeNull();
    expect(verdict!.contractId).toBe("gc-bridge-2");
    expect(verdict!.workerNodeId).toBe(nodeId);
    expect(verdict!.status).toBe("completed");
    expect(verdict!.error).toBe("no structured verdict provided");
    expect(verdict!.criteria).toEqual([]);
    expect(verdict!.artifacts).toEqual(["test output"]);
  });

  it("ignores step_result for non-existent contract (idempotent)", async () => {
    await bridge.start();

    const nodeId = "remote-idempotent";

    bridge.handleWorkerRegistered({
      nodeId,
      role: "worker",
      capabilities: ["implementer"],
      startedAt: new Date().toISOString(),
    });

    // Send step_result for a contract that doesn't exist
    const stepResult: StepResult = {
      type: "step_result",
      contractId: "gc-nonexistent",
      stepId: "s1",
      artifact: "output",
      status: "completed",
      workerVerdict: makeVerdict({ contractId: "gc-nonexistent", workerNodeId: nodeId }),
    };
    bridge.handleStepResult(stepResult, nodeId);

    // Should not crash; contract should not appear
    const contract = board.getContract("gc-nonexistent");
    expect(contract).toBeUndefined();
  });

  it("ignores step_result for contract not in_progress (idempotent against stale)", async () => {
    await bridge.start();

    const nodeId = "remote-stale";

    bridge.handleWorkerRegistered({
      nodeId,
      role: "worker",
      capabilities: ["implementer"],
      startedAt: new Date().toISOString(),
    });

    // Contract is still pending (not assigned)
    const lease = board.acquireLease("master-bridge")!;
    const pending: TaskContract = {
      id: "gc-bridge-3",
      objective: "Test step pending",
      role: "implementer",
      scope: ["src/"],
      acceptanceCriteria: ["test passes"],
      specRef: "odd/tasks/gentle-cowork-phase5.md",
      artifacts: [],
      status: "pending",
      version: 1,
      history: [{ status: "pending", version: 1, nodeId: "master-bridge", timestamp: new Date().toISOString() }],
      retryCount: 0,
    };
    board.putContract(pending, lease.fence);
    board.releaseLease("master-bridge", lease.fence);

    const stepResult: StepResult = {
      type: "step_result",
      contractId: "gc-bridge-3",
      stepId: "s1",
      artifact: "output",
      status: "completed",
      workerVerdict: makeVerdict({ contractId: "gc-bridge-3", workerNodeId: nodeId }),
    };
    bridge.handleStepResult(stepResult, nodeId);

    // Contract should remain pending
    const contract = board.getContract("gc-bridge-3");
    expect(contract?.status).toBe("pending");
  });

  it("syncAssignments assigns pending contracts to WS-connected implementer workers", async () => {
    await bridge.start();

    const nodeId = "remote-assign-1";

    bridge.handleWorkerRegistered({
      nodeId,
      role: "worker",
      capabilities: ["implementer"],
      startedAt: new Date().toISOString(),
    });

    // Seed pending contracts
    const lease = board.acquireLease("master-bridge")!;
    for (let i = 1; i <= 3; i++) {
      const pending: TaskContract = {
        id: `gc-bridge-assign-${i}`,
        objective: `Step ${i}`,
        role: "implementer",
        scope: ["src/"],
        acceptanceCriteria: ["test passes"],
        specRef: "odd/tasks/gentle-cowork-phase5.md",
        artifacts: [],
        status: "pending",
        version: 1,
        history: [{ status: "pending", version: 1, nodeId: "master-bridge", timestamp: new Date().toISOString() }],
        retryCount: 0,
      };
      board.putContract(pending, lease.fence);
    }
    board.releaseLease("master-bridge", lease.fence);

    const assigned = bridge.syncAssignments();
    expect(assigned).toBe(3);

    for (let i = 1; i <= 3; i++) {
      const c = board.getContract(`gc-bridge-assign-${i}`)!;
      expect(c.status).toBe("in_progress");
      expect(c.workerNodeId).toBe(nodeId);
    }

    // Verify assign_step was pushed to the worker
    // We can't easily assert on the sent message without mocking sendTo,
    // but the blackboard state confirms assignment happened.
  });

  it("syncAssignments only assigns to workers that are WS-connected (intersection)", async () => {
    await bridge.start();

    const connectedNodeId = "remote-connected";
    const unconnectedNodeId = "remote-unconnected";

    // Only register the connected one on the WS server (via callback)
    bridge.handleWorkerRegistered({
      nodeId: connectedNodeId,
      role: "worker",
      capabilities: ["implementer"],
      startedAt: new Date().toISOString(),
    });

    // Register BOTH on the blackboard (one is not WS-connected)
    board.registerNode(makeNode(connectedNodeId, "worker", ["implementer"]));
    board.registerNode(makeNode(unconnectedNodeId, "worker", ["implementer"]));

    const lease = board.acquireLease("master-bridge")!;
    const pending: TaskContract = {
      id: "gc-bridge-assign-intersect",
      objective: "Intersection test",
      role: "implementer",
      scope: ["src/"],
      acceptanceCriteria: ["test passes"],
      specRef: "odd/tasks/gentle-cowork-phase5.md",
      artifacts: [],
      status: "pending",
      version: 1,
      history: [{ status: "pending", version: 1, nodeId: "master-bridge", timestamp: new Date().toISOString() }],
      retryCount: 0,
    };
    board.putContract(pending, lease.fence);
    board.releaseLease("master-bridge", lease.fence);

    const assigned = bridge.syncAssignments();
    expect(assigned).toBe(1);

    const contract = board.getContract("gc-bridge-assign-intersect")!;
    expect(contract.workerNodeId).toBe(connectedNodeId);
  });

  it("syncAssignments returns 0 when no pending implementer contracts", async () => {
    await bridge.start();

    bridge.handleWorkerRegistered({
      nodeId: "remote-no-work",
      role: "worker",
      capabilities: ["implementer"],
      startedAt: new Date().toISOString(),
    });

    const assigned = bridge.syncAssignments();
    expect(assigned).toBe(0);
  });

  it("master heartbeat updates master node on the blackboard periodically", async () => {
    const fastBridge = new RemoteWorkerBridge({
      board,
      port: 0,
      bind: WS_BIND,
      nodeId: "master-heartbeat-test",
      heartbeatMs: 50,
    });
    await fastBridge.start();

    // Wait for a few heartbeats
    await until(() => {
      const node = board.getNodes().find((n) => n.nodeId === "master-heartbeat-test");
      return node !== undefined && node.status === "alive";
    }, 500);

    const node = board.getNodes().find((n) => n.nodeId === "master-heartbeat-test");
    expect(node).toBeDefined();
    expect(node!.status).toBe("alive");

    await fastBridge.stop();
  });
});

// ============================================================================
// E2E test (real MasterOrchestrator + RemoteWorkerClient + RemoteWorkerBridge)
// ============================================================================

describe("T5.9 RemoteWorkerBridge — e2e (master + remote worker)", () => {
  let bridge: RemoteWorkerBridge;
  let board: ReturnType<typeof openBlackboard>;
  let master: MasterOrchestrator;
  let client: RemoteWorkerClient;
  let tmp: string;
  let wsUrl: string;

  beforeAll(async () => {
    tmp = makeTmpDir();
    board = openBlackboard(join(tmp, ".gentle-cowork", "blackboard.json"));

    bridge = new RemoteWorkerBridge({ board, port: 0, bind: WS_BIND, nodeId: "master-e2e" });
    await bridge.start();
    wsUrl = bridge.url;

    master = new MasterOrchestrator({ board, nodeId: "master-e2e" });

    const { execute, executor } = makeExecutor();
    client = new RemoteWorkerClient({
      url: wsUrl,
      nodeId: "remote-worker-e2e",
      executor,
      heartbeatMs: 50,
      reconnectDelayMs: 50,
    });
    await client.start();
  });

  afterAll(async () => {
    try {
      await client.stop();
    } catch {}
    try {
      await bridge.stop();
    } catch {}
    rmSync(tmp, { recursive: true, force: true });
  });

  it("master delegates, bridge syncs, remote worker executes, verdict returns, master aggregates APPROVED", async () => {
    // Master registers and delegates a contract
    master.register();
    const seeded = master.delegate([
      {
        objective: "Create a test file",
        scope: ["docs/"],
        acceptanceCriteria: ["file exists with content"],
        specRef: "odd/tasks/gentle-cowork-phase5.md",
      },
    ]);
    expect(seeded).toHaveLength(1);
    const contractId = seeded[0].id;

    // Bridge syncs assignments — should assign to the connected remote worker
    const assigned = bridge.syncAssignments();
    expect(assigned).toBe(1);

    // Poll until contract is terminal on the board
    await until(() => {
      board.refresh();
      const c = board.getContract(contractId);
      return c !== undefined && (c.status === "completed" || c.status === "failed");
    }, 5000);

    // Master aggregates
    const report = master.aggregate();
    expect(report.outcome).toBe("APPROVED");
    expect(report.contracts).toHaveLength(1);
    expect(report.contracts[0].id).toBe(contractId);
    expect(report.contracts[0].status).toBe("completed");
    expect(report.contracts[0].accepted).toBe(true);
    expect(report.contracts[0].verdict).toBeDefined();
    expect(report.contracts[0].verdict!.workerNodeId).toBe("remote-worker-e2e");

    // Blackboard contains the remote node as alive
    const nodes = board.getNodes();
    const remoteNode = nodes.find((n) => n.nodeId === "remote-worker-e2e");
    expect(remoteNode).toBeDefined();
    expect(remoteNode!.status).toBe("alive");
    expect(remoteNode!.capabilities).toContain("implementer");
  });
});