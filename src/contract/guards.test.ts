/**
 * Phase 6.4: Budget guards for the oracle.
 *
 * Evaluates per-dimension budget state against the contract's declared limits.
 * Returns a structured verdict that the master can act on (pause, escalate, continue).
 */

import { describe, expect, it } from "vitest";
import type { Budget, BudgetLimit } from "../contract/schema.ts";
import { evaluateGuards, type GuardResult, type GuardConfig } from "./guards.ts";

const makeLimit = (limit: number | null, measured: number | null): BudgetLimit => ({ limit, measured });

const budget = (over: Partial<Budget> = {}): Budget => ({
  modelCalls: makeLimit(100, 50),
  tokens: makeLimit(50_000, 25_000),
  wallTime: makeLimit(600_000, 300_000),
  ...over,
});

const defaultConfig: GuardConfig = {
  warningThreshold: 0.8,
  pauseThreshold: 1.0,
  onExceeded: "pause+escalate",
  onWarning: "escalate",
};

describe("evaluateGuards (6.4)", () => {
  it("returns ok when all dimensions are below warning threshold", () => {
    const b = budget({ modelCalls: makeLimit(100, 50), tokens: makeLimit(50_000, 25_000), wallTime: makeLimit(600_000, 300_000) });
    const result = evaluateGuards(b, defaultConfig);
    expect(result.modelCalls.state).toBe("ok");
    expect(result.tokens.state).toBe("ok");
    expect(result.wallTime.state).toBe("ok");
  });

  it("returns warning when ratio >= 80% (default warning threshold)", () => {
    const b = budget({ modelCalls: makeLimit(100, 80) }); // exactly 80%
    const result = evaluateGuards(b, defaultConfig);
    expect(result.modelCalls.state).toBe("warning");
    expect(result.modelCalls.ratio).toBe(0.8);
  });

  it("returns warning when ratio > 80%", () => {
    const b = budget({ modelCalls: makeLimit(100, 85) });
    const result = evaluateGuards(b, defaultConfig);
    expect(result.modelCalls.state).toBe("warning");
  });

  it("returns exceeded when ratio >= 100% (pause threshold)", () => {
    const b = budget({ modelCalls: makeLimit(100, 100) });
    const result = evaluateGuards(b, defaultConfig);
    expect(result.modelCalls.state).toBe("exceeded");
    expect(result.modelCalls.ratio).toBe(1.0);
  });

  it("returns exceeded when ratio > 100%", () => {
    const b = budget({ modelCalls: makeLimit(100, 120) });
    const result = evaluateGuards(b, defaultConfig);
    expect(result.modelCalls.state).toBe("exceeded");
  });

  it("returns unknown when limit is null (unlimited)", () => {
    const b = budget({ modelCalls: makeLimit(null, 999) });
    const result = evaluateGuards(b, defaultConfig);
    expect(result.modelCalls.state).toBe("unknown");
    expect(result.modelCalls.ratio).toBeNull();
  });

  it("returns unknown when measured is null (no data yet)", () => {
    const b = budget({ modelCalls: makeLimit(100, null) });
    const result = evaluateGuards(b, defaultConfig);
    expect(result.modelCalls.state).toBe("unknown");
  });

  it("treats a dimension with both null as unknown", () => {
    const b = budget({ modelCalls: makeLimit(null, null) });
    const result = evaluateGuards(b, defaultConfig);
    expect(result.modelCalls.state).toBe("unknown");
  });

  it("each dimension is evaluated independently", () => {
    const b = budget({
      modelCalls: makeLimit(100, 90), // warning
      tokens: makeLimit(50_000, 25_000), // ok
      wallTime: makeLimit(600_000, 600_000), // exceeded
    });
    const result = evaluateGuards(b, defaultConfig);
    expect(result.modelCalls.state).toBe("warning");
    expect(result.tokens.state).toBe("ok");
    expect(result.wallTime.state).toBe("exceeded");
  });

  it("configurable warning and pause thresholds", () => {
    const b = budget({ modelCalls: makeLimit(100, 70) });
    const config = { ...defaultConfig, warningThreshold: 0.6, pauseThreshold: 0.9 };
    const result = evaluateGuards(b, config);
    expect(result.modelCalls.state).toBe("warning"); // 70% >= 60%
  });

  it("soft degradation: when contract specifies onExceeded=degrade, action is degrade", () => {
    const b = budget({ modelCalls: makeLimit(100, 110) });
    const config = { ...defaultConfig, onExceeded: "degrade" as const };
    const result = evaluateGuards(b, config);
    expect(result.modelCalls.state).toBe("exceeded");
    expect(result.modelCalls.action).toBe("degrade");
  });

  it("default action for exceeded is pause+escalate", () => {
    const b = budget({ modelCalls: makeLimit(100, 110) });
    const result = evaluateGuards(b, defaultConfig);
    expect(result.modelCalls.action).toBe("pause+escalate");
  });

  it("default action for warning is escalate", () => {
    const b = budget({ modelCalls: makeLimit(100, 85) });
    const result = evaluateGuards(b, defaultConfig);
    expect(result.modelCalls.action).toBe("escalate");
  });
});