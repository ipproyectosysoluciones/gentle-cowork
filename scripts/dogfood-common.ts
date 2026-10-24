/**
 * dogfood-common — Shared utilities for master/worker dogfooding.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TaskContract } from "../src/types.ts";

/** Creates a scratch directory for dogfooding. */
export function makeDogfoodDir(): string {
  return mkdtempSync(join(tmpdir(), "gentle-cowork-dogfood-"));
}

/** Cleans up the dogfooding directory. */
export function cleanupDogfoodDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Builds a well-formed TaskContract with optional overrides. */
export function makeContract(overrides: Partial<TaskContract> = {}): TaskContract {
  const now = new Date().toISOString();
  return {
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
      nodeId: "dogfood",
      timestamp: now,
    }],
    leaseFence: overrides.leaseFence,
    retryCount: 0,
    workerNodeId: overrides.workerNodeId,
    ...overrides,
  };
}

export function log(message: string, prefix = "DOGFOOD"): void {
  console.error(`[${new Date().toISOString()}] [${prefix}] ${message}`);
}