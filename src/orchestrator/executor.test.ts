/**
 * Phase 6.3: metered executor wrapper tests.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openBlackboard, defaultBlackboardPath } from "../blackboard.ts";
import type { StepExecutor, WorkerStepVerdict } from "./types.ts";
import type { TaskContract } from "../types.ts";
import { meteredStepExecutor } from "./executor.ts";

const makeContract = (over: Partial<TaskContract> = {}): TaskContract => ({
  id: "gc-1",
  objective: "test objective",
  role: "implementer" as const,
  scope: ["src/"],
  acceptanceCriteria: ["works"],
  specRef: "spec.md",
  artifacts: [],
  status: "pending" as const,
  version: 1,
  history: [{ status: "pending" as const, version: 1, nodeId: "test", timestamp: new Date().toISOString() }],
  ...over,
});

const makeTmpDir = (): string => mkdtempSync(join(tmpdir(), "gentle-cowork-metered-"));

describe("meteredStepExecutor (6.3)", () => {
  it("records one model call and wall time per execute; tokens null in this boundary", async () => {
    const tmp = makeTmpDir();
    try {
      const filePath = defaultBlackboardPath(tmp);
      const { mkdirSync } = await import("node:fs");
      mkdirSync(join(tmp, ".gentle-cowork"), { recursive: true });

      // Mock executor that returns a completed verdict
      const mockExecutor: StepExecutor = {
        async execute(contract) {
          return {
            contractId: contract.id,
            workerNodeId: "test-worker",
            status: "completed",
            criteria: contract.acceptanceCriteria.map((criterion) => ({ criterion, satisfied: true, evidence: "done" })),
            artifacts: [],
            executedAt: new Date().toISOString(),
          };
        },
      };

      const board = openBlackboard(filePath);
      const metered = meteredStepExecutor(mockExecutor, board, "worker-a");

      const contract = makeContract({ id: "t1" });
      const verdict = await metered.execute(contract);

      expect(verdict.status).toBe("completed");

      // Check the board recorded the usage
      const usage = board.usageByContract("t1");
      expect(usage).toBeDefined();
      expect(usage!.modelCalls).toBe(1);
      expect(usage!.events).toBe(1);
      expect(usage!.wallTimeMs).toBeGreaterThanOrEqual(0);
      expect(usage!.tokens).toBeNull(); // boundary does not expose tokens
      expect(usage!.byNode["worker-a"]).toBeDefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("aggregates across multiple contracts and nodes", async () => {
    const tmp = makeTmpDir();
    try {
      const filePath = defaultBlackboardPath(tmp);
      const { mkdirSync } = await import("node:fs");
      mkdirSync(join(tmp, ".gentle-cowork"), { recursive: true });

      const mockExecutor: StepExecutor = {
        async execute(contract) {
          return {
            contractId: contract.id,
            workerNodeId: "test-worker",
            status: "completed",
            criteria: contract.acceptanceCriteria.map((criterion) => ({ criterion, satisfied: true, evidence: "done" })),
            artifacts: [],
            executedAt: new Date().toISOString(),
          };
        },
      };

      const board = openBlackboard(filePath);

      const meteredA = meteredStepExecutor(mockExecutor, board, "worker-a");
      const meteredB = meteredStepExecutor(mockExecutor, board, "worker-b");

      await meteredA.execute(makeContract({ id: "t1" }));
      await meteredA.execute(makeContract({ id: "t1" }));
      await meteredB.execute(makeContract({ id: "t2" }));

      const totals = board.usageTotals();
      expect(totals.contracts).toBe(2);
      expect(totals.modelCalls).toBe(3);
      expect(totals.events).toBe(3);
      expect(totals.tokens).toBeNull();

      const byContract1 = board.usageByContract("t1");
      expect(byContract1?.byNode["worker-a"]?.events).toBe(2);
      expect(byContract1?.byNode["worker-b"]).toBeUndefined();

      const byContract2 = board.usageByContract("t2");
      expect(byContract2?.byNode["worker-b"]?.events).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});