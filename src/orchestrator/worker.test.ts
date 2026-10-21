/**
 * T5.8 Master Orchestration Slice — LocalWorker unit tests (RED phase).
 *
 * The worker registers with implementer capability, claims contracts the
 * master assigned to it (in_progress + workerNodeId === mine), executes via
 * an injectable StepExecutor, and writes the WorkerStepVerdict + terminal
 * status atomically to the blackboard under a short lease with fence.
 * Unit tests never spawn a real subprocess — mock executors only (L15 amendment 4).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openBlackboard } from "../blackboard.ts";
import type { TaskContract } from "../types.ts";
import { LocalWorker } from "./worker.ts";
import { extractWorkerVerdict } from "./verdict.ts";
import type { StepExecutor, WorkerStepVerdict } from "./types.ts";

/** Creates a scratch directory for one test's state file. */
function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "gentle-cowork-orchworker-"));
}

/** Builds a mock executor returning canned verdicts (or throwing). */
function mockExecutor(behavior: (contract: TaskContract) => WorkerStepVerdict): StepExecutor & { calls: TaskContract[] } {
  const calls: TaskContract[] = [];
  return {
    calls,
    async execute(contract: TaskContract) {
      calls.push(contract);
      return behavior(contract);
    },
  };
}

function throwingExecutor(error: Error): StepExecutor {
  return {
    async execute() {
      throw error;
    },
  };
}

function makeVerdict(contractId: string, workerNodeId: string, overrides: Partial<WorkerStepVerdict> = {}): WorkerStepVerdict {
  return {
    contractId,
    workerNodeId,
    status: "completed",
    criteria: [{ criterion: "file exists with exact content", satisfied: true, evidence: "created docs/demo.md" }],
    artifacts: ["docs/demo.md"],
    executedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Seeds a contract already assigned to the given worker (as the master would leave it). */
function seedAssignedContract(
  board: ReturnType<typeof openBlackboard>,
  id: string,
  workerNodeId: string,
  overrides: Partial<TaskContract> = {},
): TaskContract {
  const now = new Date().toISOString();
  const contract: TaskContract = {
    id,
    objective: "Create docs/demo.md with one line",
    role: "implementer",
    scope: ["docs/"],
    acceptanceCriteria: ["file exists with exact content"],
    specRef: "odd/tasks/gentle-cowork-phase5.md",
    artifacts: [],
    status: "in_progress",
    version: 2,
    workerNodeId,
    history: [
      { status: "pending", version: 1, nodeId: "master-1", timestamp: now },
      { status: "in_progress", version: 2, nodeId: workerNodeId, timestamp: now },
    ],
    retryCount: 0,
    ...overrides,
  };
  const lease = board.acquireLease("master-1")!;
  board.putContract(contract, lease.fence);
  board.releaseLease("master-1", lease.fence);
  return contract;
}

describe("orchestrator — LocalWorker (T5.8)", () => {
  it("registers as a worker with the implementer capability", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(join(tmp, ".gentle-cowork", "blackboard.json"));
      const worker = new LocalWorker({ board, nodeId: "worker-1", executor: mockExecutor(() => {
        throw new Error("not used in this test");
      }) });

      worker.register();

      const self = board.getNodes().find((n) => n.nodeId === "worker-1");
      expect(self).toBeDefined();
      expect(self!.role).toBe("worker");
      expect(self!.capabilities).toEqual(["implementer"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("claims a contract the master assigned to it", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(join(tmp, ".gentle-cowork", "blackboard.json"));
      const worker = new LocalWorker({ board, nodeId: "worker-1", executor: mockExecutor(() => {
        throw new Error("not used in this test");
      }) });
      seedAssignedContract(board, "gc-1", "worker-1");

      const claimed = worker.claimNext();

      expect(claimed).toBeDefined();
      expect(claimed!.id).toBe("gc-1");
      expect(claimed!.workerNodeId).toBe("worker-1");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not claim contracts assigned to another worker", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(join(tmp, ".gentle-cowork", "blackboard.json"));
      const worker = new LocalWorker({ board, nodeId: "worker-2", executor: mockExecutor(() => {
        throw new Error("not used in this test");
      }) });
      seedAssignedContract(board, "gc-1", "worker-1");

      expect(worker.claimNext()).toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not claim non-implementer contracts", () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(join(tmp, ".gentle-cowork", "blackboard.json"));
      const worker = new LocalWorker({ board, nodeId: "worker-1", executor: mockExecutor(() => {
        throw new Error("not used in this test");
      }) });
      seedAssignedContract(board, "gc-1", "worker-1", { role: "planner" });

      expect(worker.claimNext()).toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("executes an assigned contract via the injected executor and writes the verdict to the blackboard", async () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(join(tmp, ".gentle-cowork", "blackboard.json"));
      const executor = mockExecutor((contract) => makeVerdict(contract.id, "worker-1"));
      const worker = new LocalWorker({ board, nodeId: "worker-1", executor });
      const seeded = seedAssignedContract(board, "gc-1", "worker-1");

      const claimed = worker.claimNext()!;
      const verdict = await worker.executeAssigned(claimed);

      expect(executor.calls).toHaveLength(1);
      expect(executor.calls[0].id).toBe("gc-1");
      expect(verdict.status).toBe("completed");

      // The blackboard holds the terminal status + the verdict (coordination point)
      const stored = board.getContract("gc-1")!;
      expect(stored.status).toBe("completed");
      const written = extractWorkerVerdict(stored);
      expect(written).not.toBeNull();
      expect(written!.contractId).toBe("gc-1");
      expect(written!.criteria[0].satisfied).toBe(true);
      expect(stored.artifacts).toContain("docs/demo.md");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("writes a failed verdict when the executor throws", async () => {
    const tmp = makeTmpDir();
    try {
      const board = openBlackboard(join(tmp, ".gentle-cowork", "blackboard.json"));
      const worker = new LocalWorker({
        board,
        nodeId: "worker-1",
        executor: throwingExecutor(new Error("boom during execution")),
      });
      const seeded = seedAssignedContract(board, "gc-1", "worker-1");

      const claimed = worker.claimNext()!;
      const verdict = await worker.executeAssigned(claimed);

      expect(verdict.status).toBe("failed");
      expect(verdict.error).toContain("boom during execution");

      const stored = board.getContract("gc-1")!;
      expect(stored.status).toBe("failed");
      expect(extractWorkerVerdict(stored)!.error).toContain("boom");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("runUntil executes assigned work until the done predicate turns true", async () => {
    const tmp = makeTmpDir();
    try {
      const filePath = join(tmp, ".gentle-cowork", "blackboard.json");
      const board = openBlackboard(filePath);
      const worker = new LocalWorker({
        board,
        nodeId: "worker-1",
        executor: mockExecutor((contract) => makeVerdict(contract.id, "worker-1")),
        pollIntervalMs: 10,
      });
      worker.register();
      seedAssignedContract(board, "gc-1", "worker-1");

      await worker.runUntil(() => board.getContract("gc-1")?.status === "completed", { maxMs: 5000 });

      expect(board.getContract("gc-1")!.status).toBe("completed");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
