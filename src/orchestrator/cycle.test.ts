/**
 * T5.8 Master Orchestration Slice — master-worker cycle tests (RED phase).
 *
 * THE LOCAL STAGE EXIT CRITERIA (verbatim from L15):
 *   "Un master local + un worker local (mismo machine) → el master delega un
 *    paso → el worker ejecuta → el worker escribe el verdict en el blackboard
 *    → el master lee el verdict y reporta APPROVED/CHANGES".
 *
 * Same machine, shared blackboard file, two independent board handles (the
 * multi-process simulation), mock executors — no real subprocess (L15
 * amendment 4). The blackboard is the ONLY coordination point: master and
 * worker exchange nothing directly.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { openBlackboard } from "../blackboard.ts";
import type { TaskContract } from "../types.ts";
import { MasterOrchestrator } from "./master.ts";
import { LocalWorker } from "./worker.ts";
import type { StepExecutor, WorkerStepVerdict } from "./types.ts";

/** Creates a scratch directory holding the shared blackboard file. */
function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "gentle-cowork-cycle-"));
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

function mockExecutor(behavior: (contract: TaskContract) => WorkerStepVerdict): StepExecutor {
  return {
    async execute(contract: TaskContract) {
      return behavior(contract);
    },
  };
}

const SEED = {
  objective: "Create docs/demo.md with exactly one line: 'demo'",
  scope: ["docs/"],
  acceptanceCriteria: ["file exists with exact content"],
  specRef: "odd/tasks/gentle-cowork-phase5.md",
};

/** True when the board shows at least `min` contracts and every one is terminal. */
function allTerminal(board: ReturnType<typeof openBlackboard>, min = 1): boolean {
  const contracts = board.listContracts();
  return contracts.length >= min && contracts.every((c) => c.status === "completed" || c.status === "failed");
}

describe("orchestrator — master-worker cycle, same machine (T5.8 exit criteria)", () => {
  it("master delegates a step → worker executes → worker writes verdict → master reads it and reports APPROVED", async () => {
    const tmp = makeTmpDir();
    try {
      const filePath = join(tmp, ".gentle-cowork", "blackboard.json");
      const masterBoard = openBlackboard(filePath);
      const workerBoard = openBlackboard(filePath);

      const master = new MasterOrchestrator({ board: masterBoard, nodeId: "master-1", pollIntervalMs: 20, totalTimeoutMs: 5000 });
      const worker = new LocalWorker({
        board: workerBoard,
        nodeId: "worker-1",
        executor: mockExecutor((contract) => makeVerdict(contract.id, "worker-1")),
        pollIntervalMs: 20,
      });
      worker.register();

      const [report] = await Promise.all([
        master.runCycle([SEED]),
        worker.runUntil(() => allTerminal(workerBoard), { maxMs: 5000 }),
      ]);

      // Exit criteria, verbatim: the master reads the worker's verdict and reports
      expect(report.outcome).toBe("APPROVED");
      expect(report.contracts[0].status).toBe("completed");
      expect(report.contracts[0].verdict).toBeDefined();
      expect(report.contracts[0].verdict!.workerNodeId).toBe("worker-1");
      expect(report.contracts[0].accepted).toBe(true);

      // The verdict physically lives on the blackboard (coordination point)
      const stored = workerBoard.getContract("gc-1");
      expect(stored!.status).toBe("completed");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reports CHANGES when the worker execution fails", async () => {
    const tmp = makeTmpDir();
    try {
      const filePath = join(tmp, ".gentle-cowork", "blackboard.json");
      const masterBoard = openBlackboard(filePath);
      const workerBoard = openBlackboard(filePath);

      const master = new MasterOrchestrator({ board: masterBoard, nodeId: "master-1", pollIntervalMs: 20, totalTimeoutMs: 5000 });
      const worker = new LocalWorker({
        board: workerBoard,
        nodeId: "worker-1",
        executor: {
          async execute() {
            throw new Error("implementation blew up");
          },
        },
        pollIntervalMs: 20,
      });
      worker.register();

      const [report] = await Promise.all([
        master.runCycle([SEED]),
        worker.runUntil(() => allTerminal(workerBoard), { maxMs: 5000 }),
      ]);

      expect(report.outcome).toBe("CHANGES");
      expect(report.contracts[0].status).toBe("failed");
      expect(report.contracts[0].reason).toContain("implementation blew up");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reports CHANGES when the worker verdict lacks evidence for an acceptance criterion", async () => {
    const tmp = makeTmpDir();
    try {
      const filePath = join(tmp, ".gentle-cowork", "blackboard.json");
      const masterBoard = openBlackboard(filePath);
      const workerBoard = openBlackboard(filePath);

      const master = new MasterOrchestrator({ board: masterBoard, nodeId: "master-1", pollIntervalMs: 20, totalTimeoutMs: 5000 });
      const worker = new LocalWorker({
        board: workerBoard,
        nodeId: "worker-1",
        executor: mockExecutor((contract) =>
          makeVerdict(contract.id, "worker-1", {
            criteria: [], // claims completion but no per-criterion evidence
          }),
        ),
        pollIntervalMs: 20,
      });
      worker.register();

      const [report] = await Promise.all([
        master.runCycle([SEED]),
        worker.runUntil(() => allTerminal(workerBoard), { maxMs: 5000 }),
      ]);

      expect(report.outcome).toBe("CHANGES");
      expect(report.contracts[0].accepted).toBe(false);
      expect(report.contracts[0].reason).toContain("file exists with exact content");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("distributes and completes multiple steps in one cycle", async () => {
    const tmp = makeTmpDir();
    try {
      const filePath = join(tmp, ".gentle-cowork", "blackboard.json");
      const masterBoard = openBlackboard(filePath);
      const workerBoard = openBlackboard(filePath);

      const master = new MasterOrchestrator({ board: masterBoard, nodeId: "master-1", pollIntervalMs: 20, totalTimeoutMs: 8000 });
      const worker = new LocalWorker({
        board: workerBoard,
        nodeId: "worker-1",
        executor: mockExecutor((contract) => makeVerdict(contract.id, "worker-1")),
        pollIntervalMs: 20,
      });
      worker.register();

      const [report] = await Promise.all([
        master.runCycle([SEED, { ...SEED, objective: "Second step" }, { ...SEED, objective: "Third step" }]),
        worker.runUntil(() => allTerminal(workerBoard, 3), { maxMs: 8000 }),
      ]);

      expect(report.outcome).toBe("APPROVED");
      expect(report.contracts).toHaveLength(3);
      for (const entry of report.contracts) {
        expect(entry.status).toBe("completed");
        expect(entry.verdict).toBeDefined();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reports CHANGES with a timeout reason when no worker claims the step", async () => {
    const tmp = makeTmpDir();
    try {
      const filePath = join(tmp, ".gentle-cowork", "blackboard.json");
      const masterBoard = openBlackboard(filePath);

      const master = new MasterOrchestrator({ board: masterBoard, nodeId: "master-1", pollIntervalMs: 20, totalTimeoutMs: 600 });

      const report = await master.runCycle([SEED]);

      expect(report.outcome).toBe("CHANGES");
      expect(report.contracts[0].status).toBe("pending");
      expect(report.contracts[0].reason).toBeDefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
