/**
 * Phase 4 tests — blackboard state persistence (spec S5).
 *
 * A shared state file (JSON) that all roles read/write; TaskContract
 * persistence across the full pending → in_progress → completed/failed
 * lifecycle; the board survives a fresh open (simulated daemon restart);
 * an interrupted chain loses nothing. A corrupt or missing state file
 * fails safe to an empty board, never a crash.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { defaultBlackboardPath, openBlackboard } from "./blackboard.ts";
import type { TaskContract } from "./types.ts";

/** Creates a scratch directory for one test's state file. */
function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "gentle-cowork-blackboard-"));
}

/** Builds a well-formed TaskContract with optional overrides. */
function makeContract(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    id: "gc-1",
    objective: "Verify the widget module",
    role: "planner",
    scope: ["src/widget/"],
    acceptanceCriteria: ["all widget tests pass"],
    specRef: "odd/tasks/gentle-cowork-extension.md",
    artifacts: [],
    status: "pending",
    ...overrides,
  };
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
        expect(errorSpy).toHaveBeenCalledTimes(fixtures.length);
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
          version: 1,
          contracts: [valid, "a bare string", { id: "gc-3" }, null, { ...valid, id: "gc-4", status: "bogus" }],
        }),
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const board = openBlackboard(filePath);
        expect(board.listContracts()).toEqual([valid]);
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
      expect(board.updateStatus("gc-42", "in_progress")?.status).toBe("in_progress");
      expect(board.updateStatus("gc-42", "completed")?.status).toBe("completed");

      const failedTask = makeContract({ id: "gc-43", objective: "Second task", status: "pending" });
      board.putContract(failedTask);
      board.updateStatus("gc-43", "in_progress");
      board.updateStatus("gc-43", "failed");

      // Simulated daemon restart: a fresh open reads the same state file.
      const restarted = openBlackboard(filePath);
      expect(restarted.listContracts()).toEqual([
        { ...completedTask, status: "completed" },
        { ...failedTask, status: "failed" },
      ]);
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

      expect(board.updateStatus("gc-missing", "completed")).toBeUndefined();
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
      expect(restarted.listContracts()).toEqual([firstCompleted, second]);
      expect(restarted.listContracts().filter((c) => c.id === "gc-1")).toHaveLength(1);
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
      expect(raw.version).toBe(1);
      expect(raw.contracts).toEqual([contract]);
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
      expect(restarted.getContract("gc-1")).toEqual(makeContract());
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
