#!/usr/bin/env node
/**
 * Phase 6 Dogfood: exercises metering + guards with a real blackboard.
 */

import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openBlackboard, defaultBlackboardPath } from "../src/blackboard.ts";
import { meteredStepExecutor } from "../src/orchestrator/executor.ts";

const TMP = tmpdir();
const BOARD_DIR = join(TMP, "gentle-cowork-dogfood-phase6");
mkdirSync(BOARD_DIR, { recursive: true });
const filePath = defaultBlackboardPath(BOARD_DIR);
console.log(`[DOGFOOD] Blackboard at: ${filePath}`);

const board = openBlackboard(filePath);

// A mock executor that does nothing but returns completed
const mockExecutor = {
  async execute(contract) {
    await new Promise((r) => setTimeout(r, 50));
    return {
      contractId: contract.id,
      workerNodeId: "dogfood-worker",
      status: "completed",
      criteria: contract.acceptanceCriteria.map((c) => ({ criterion: c, satisfied: true, evidence: "mock done" })),
      artifacts: [`mock-artifact-for-${contract.id}`],
      executedAt: new Date().toISOString(),
    };
  },
};

// Wrap with metering
const metered = meteredStepExecutor(mockExecutor, board, "dogfood-worker");

const budget = {
  modelCalls: { limit: 10, measured: null },
  tokens: { limit: 1000, measured: null },
  wallTime: { limit: 60000, measured: null },
};

const contracts = [
  {
    id: "dogfood-1",
    objective: "Test contract 1",
    role: "implementer",
    scope: ["src/"],
    acceptanceCriteria: ["criterion A", "criterion B"],
    specRef: "odd/tasks/phase6-oracle.md",
    artifacts: [],
    status: "pending",
    version: 1,
    history: [{ status: "pending", version: 1, nodeId: "dogfood", timestamp: new Date().toISOString() }],
    budget,
  },
  {
    id: "dogfood-2",
    objective: "Test contract 2",
    role: "implementer",
    scope: ["src/"],
    acceptanceCriteria: ["criterion C"],
    specRef: "odd/tasks/phase6-oracle.md",
    artifacts: [],
    status: "pending",
    version: 1,
    history: [{ status: "pending", version: 1, nodeId: "dogfood", timestamp: new Date().toISOString() }],
    budget,
  },
];

console.log(`[DOGFOOD] Created ${contracts.length} contracts with budgets`);

const lease = board.acquireLease("dogfood-master");
if (!lease) throw new Error("no lease");
for (const c of contracts) {
  board.putContract(c, lease.fence);
}
board.releaseLease("dogfood-master", lease.fence);

console.log("[DOGFOOD] Executing contracts...");
for (const c of contracts) {
  const verdict = await metered.execute(c);
  console.log(`  ${c.id}: ${verdict.status}, artifacts: ${verdict.artifacts.length}`);
}

console.log("\n[DOGFOOD] Usage captured in blackboard:");
const totals = board.usageTotals();
console.log(`  Totals: ${JSON.stringify(totals, null, 2)}`);

for (const c of contracts) {
  const usage = board.usageByContract(c.id);
  console.log(`  ${c.id}: ${JSON.stringify(usage, null, 2)}`);
}

rmSync(BOARD_DIR, { recursive: true, force: true });
console.log("\n[DOGFOOD] Done - usage captured successfully!");
