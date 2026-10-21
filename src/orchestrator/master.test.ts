/**
 * T5.8 Master Orchestration Slice — MasterOrchestrator unit tests (RED phase).
 *
 * The master coordinates through the blackboard only (L15 amendment 2):
 * it registers (T5.3 registry), seeds pending implementer contracts,
 * routes them to alive workers (assignment state on the contract), and
 * aggregates worker verdicts into an APPROVED/CHANGES report.
 * Unit tests never spawn a real subprocess — mock executors only (L15 amendment 4).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openBlackboard } from "../blackboard.ts";
import type { NodeRegistration, TaskContract } from "../types.ts";
import { MasterOrchestrator } from "./master.ts";
import { extractWorkerVerdict } from "./verdict.ts";
import type { WorkerStepVerdict } from "./types.ts";

/** Creates a scratch directory for one test's state file. */
function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "gentle-cowork-orchestrator-"));
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

function makeSeed(overrides: Partial<ContractSeedStub> = {}): ContractSeedStub {
  return {
    objective: "Create docs/demo.md with one line",
    scope: ["docs/"],
    acceptanceCriteria: ["file exists with exact content"],
    specRef: "odd/tasks/gentle-cowork-phase5.md",
    ...overrides,
  };
}

interface ContractSeedStub {
  objective: string;
  scope: string[];
  acceptanceCriteria: string[];
  specRef: string;
  role?: "planner" | "implementer" | "verifier";
}

/** Builds a terminal contract carrying a worker verdict in its history (as the worker would write it). */
function writeExecutedContract(
  board: ReturnType<typeof openBlackboard>,
  lease: { fence: number },
  id: string,
  verdict: WorkerStepVerdict,
): void {
  const now = new Date().toISOString();
  const pending: TaskContract = {
    id,
    objective: "Create docs/demo.md with one line",
    role: "implementer",
    scope: ["docs/"],
    acceptanceCriteria: ["file exists with exact content"],
    specRef: "odd/tasks/gentle-cowork-phase5.md",
    artifacts: [],
    status: "pending",
    version: 1,
    history: [{ status: "pending", version: 1, nodeId: "master-1", timestamp: now }],
    retryCount: 0,
  };
  board.putContract(pending, lease.fence);
  board.assignContract(id, verdict.workerNodeId, lease.fence);
  board.updateStatus(
    id,
    verdict.status === "completed" ? "completed" : "failed",
    verdict.workerNodeId,
    verdict.artifacts,
    lease.fence,
    [{ type: "worker_verdict", ...verdict }],
  );
}

function makeVerdict(overrides: Partial<WorkerStepVerdict> = {}): WorkerStepVerdict {
  return {
    contractId: "gc-1",
    workerNodeId: "worker-1",
    status: "completed",
    criteria: [{ criterion: "file exists with exact content", satisfied: true, evidence: "created docs/demo.md" }],
    artifacts: ["docs/demo.md"],
    executedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("orchestrator — MasterOrchestrator (T5.8)", () => {
  it("registers as master with planner + verifier capabilities", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(join(tmp, ".gentle-cowork", "blackboard.json"));
      const master = new MasterOrchestrator({ board, nodeId: "master-1" });

      master.register();

      const self = board.getNodes().find((n) => n.nodeId === "master-1");
      expect(self).toBeDefined();
      expect(self!.role).toBe("master");
      expect(self!.capabilities).toEqual(["planner", "verifier"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("delegate seeds pending implementer contracts on the blackboard", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(join(tmp, ".gentle-cowork", "blackboard.json"));
      const master = new MasterOrchestrator({ board, nodeId: "master-1" });

      const seeded = master.delegate([makeSeed(), makeSeed({ objective: "Second step" })]);

      expect(seeded).toHaveLength(2);
      for (const contract of seeded) {
        const stored = board.getContract(contract.id);
        expect(stored).toBeDefined();
        expect(stored!.status).toBe("pending");
        expect(stored!.role).toBe("implementer");
        expect(stored!.version).toBe(1);
      }
      expect(seeded[0].id).not.toBe(seeded[1].id);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("assignPending routes pending contracts to an alive implementer worker", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(join(tmp, ".gentle-cowork", "blackboard.json"));
      const master = new MasterOrchestrator({ board, nodeId: "master-1" });
      master.register();
      const lease = board.acquireLease("master-1");
      expect(lease).not.toBeNull();
      const [contract] = master.delegate([makeSeed()]);

      board.registerNode(makeNode("worker-1", "worker", ["implementer"]));

      const assigned = master.assignPending();

      expect(assigned).toBe(1);
      const stored = board.getContract(contract.id);
      expect(stored!.status).toBe("in_progress");
      expect(stored!.workerNodeId).toBe("worker-1");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("assignPending leaves contracts pending when no worker is alive", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(join(tmp, ".gentle-cowork", "blackboard.json"));
      const master = new MasterOrchestrator({ board, nodeId: "master-1" });
      master.register();
      board.acquireLease("master-1");
      const [contract] = master.delegate([makeSeed()]);

      const assigned = master.assignPending();

      expect(assigned).toBe(0);
      expect(board.getContract(contract.id)!.status).toBe("pending");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("assignPending skips workers without the implementer capability", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(join(tmp, ".gentle-cowork", "blackboard.json"));
      const master = new MasterOrchestrator({ board, nodeId: "master-1" });
      master.register();
      board.acquireLease("master-1");
      const [contract] = master.delegate([makeSeed()]);

      board.registerNode(makeNode("verifier-only", "worker", ["verifier"]));

      const assigned = master.assignPending();

      expect(assigned).toBe(0);
      expect(board.getContract(contract.id)!.status).toBe("pending");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("aggregate reports APPROVED when every contract completed with accepted evidence", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(join(tmp, ".gentle-cowork", "blackboard.json"));
      const master = new MasterOrchestrator({ board, nodeId: "master-1" });
      const lease = board.acquireLease("master-1")!;

      writeExecutedContract(board, lease, "gc-1", makeVerdict({ contractId: "gc-1" }));

      const report = master.aggregate();

      expect(report.outcome).toBe("APPROVED");
      expect(report.contracts).toHaveLength(1);
      expect(report.contracts[0].status).toBe("completed");
      expect(report.contracts[0].accepted).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("aggregate reports CHANGES with the failing criterion when evidence is missing", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(join(tmp, ".gentle-cowork", "blackboard.json"));
      const master = new MasterOrchestrator({ board, nodeId: "master-1" });
      const lease = board.acquireLease("master-1")!;

      writeExecutedContract(
        board,
        lease,
        "gc-1",
        makeVerdict({
          criteria: [{ criterion: "file exists with exact content", satisfied: false, evidence: "content mismatch" }],
        }),
      );

      const report = master.aggregate();

      expect(report.outcome).toBe("CHANGES");
      expect(report.contracts[0].accepted).toBe(false);
      expect(report.contracts[0].reason).toContain("file exists with exact content");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("aggregate reports CHANGES when a contract is not terminal", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(join(tmp, ".gentle-cowork", "blackboard.json"));
      const master = new MasterOrchestrator({ board, nodeId: "master-1" });
      const lease = board.acquireLease("master-1")!;
      board.putContract(
        {
          id: "gc-pending",
          objective: "Unfinished step",
          role: "implementer",
          scope: ["docs/"],
          acceptanceCriteria: ["file exists with exact content"],
          specRef: "odd/tasks/gentle-cowork-phase5.md",
          artifacts: [],
          status: "pending",
          version: 1,
          history: [{ status: "pending", version: 1, nodeId: "master-1", timestamp: new Date().toISOString() }],
          retryCount: 0,
        },
        lease.fence,
      );

      const report = master.aggregate();

      expect(report.outcome).toBe("CHANGES");
      expect(report.contracts[0].status).toBe("pending");
      expect(report.contracts[0].reason).toBeDefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("aggregate accepts a custom verifier and reports its verdict", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(join(tmp, ".gentle-cowork", "blackboard.json"));
      const master = new MasterOrchestrator({
        board,
        nodeId: "master-1",
        verify: () => ({ accepted: false, reason: "custom verifier says no" }),
      });
      const lease = board.acquireLease("master-1")!;
      writeExecutedContract(board, lease, "gc-1", makeVerdict({ contractId: "gc-1" }));

      const report = master.aggregate();

      expect(report.outcome).toBe("CHANGES");
      expect(report.contracts[0].reason).toBe("custom verifier says no");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("extractWorkerVerdict reads the verdict the worker wrote into the blackboard history", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(join(tmp, ".gentle-cowork", "blackboard.json"));
      const lease = board.acquireLease("master-1")!;
      writeExecutedContract(board, lease, "gc-1", makeVerdict({ contractId: "gc-1", workerNodeId: "worker-7" }));

      const stored = board.getContract("gc-1")!;
      const verdict = extractWorkerVerdict(stored);

      expect(verdict).not.toBeNull();
      expect(verdict!.contractId).toBe("gc-1");
      expect(verdict!.workerNodeId).toBe("worker-7");
      expect(verdict!.status).toBe("completed");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
