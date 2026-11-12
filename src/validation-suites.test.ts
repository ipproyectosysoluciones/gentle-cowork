/**
 * Phase 7 Slice 7.4 — Validation Suites Types Tests (RED phase)
 *
 * Tests for ValidationSuite, ValidationResult, ValidationSuiteRegistry interfaces,
 * and the three base suites: sast-basic, perf-thresholds, maintainability-metrics.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ValidationSuite,
  ValidationResult,
  ValidationFinding,
  ValidationContext,
  registerSuite,
  getSuite,
  listSuites,
  runAllSuites,
  SAST_BASIC_SUITE,
  PERF_THRESHOLDS_SUITE,
  MAINTAINABILITY_METRICS_SUITE,
} from "./validation-suites.ts";

describe("ValidationSuite interface", () => {
  beforeEach(() => {
    // Clear registry before each test
    const registry = require("./validation-suites.ts");
    // We can't easily clear the module-level registry, so we'll just be aware of base suites
  });
  it("registers a custom suite and retrieves it", () => {
    const customSuite: ValidationSuite = {
      id: "custom-test",
      name: "Custom Test Suite",
      version: "1.0.0",
      run: vi.fn(async () => ({ passed: true, findings: [], suiteId: "custom-test" })),
    };

    registerSuite(customSuite);
    const retrieved = getSuite("custom-test");
    expect(retrieved).toBe(customSuite);
  });

  it("lists all registered suites", () => {
    const suites = listSuites();
    expect(suites).toContain("sast-basic");
    expect(suites).toContain("perf-thresholds");
    expect(suites).toContain("maintainability-metrics");
  });

  it("returns undefined for non-existent suite", () => {
    expect(getSuite("non-existent")).toBeUndefined();
  });

  it("throws on duplicate registration", () => {
    const suite: ValidationSuite = {
      id: "duplicate-test",
      name: "Duplicate",
      version: "1.0.0",
      run: vi.fn(async () => ({ passed: true, findings: [], suiteId: "duplicate-test" })),
    };
    registerSuite(suite);
    expect(() => registerSuite(suite)).toThrow(/already registered/);
  });
});

describe("ValidationSuiteRegistry", () => {
    it("runs all registered suites and aggregates results", async () => {
    const suite1: ValidationSuite = {
      id: "suite-1",
      name: "Suite 1",
      version: "1.0.0",
      run: vi.fn(async () => ({ passed: true, findings: [{ id: "f1", severity: "info" as const, message: "ok" }], suiteId: "suite-1" })),
    };
    const suite2: ValidationSuite = {
      id: "suite-2",
      name: "Suite 2",
      version: "1.0.0",
      run: vi.fn(async () => ({ passed: false, findings: [{ id: "f2", severity: "error" as const, message: "fail" }], suiteId: "suite-2" })),
    };

    registerSuite(suite1);
    registerSuite(suite2);

    const results = await runAllSuites({});
    // Base suites (sast-basic, perf-thresholds, maintainability-metrics) + 2 test suites = 5
    expect(results.length).toBeGreaterThanOrEqual(5);
    const ourSuite1 = results.find(r => r.suiteId === "suite-1");
    const ourSuite2 = results.find(r => r.suiteId === "suite-2");
    expect(ourSuite1).toBeDefined();
    expect(ourSuite1!.passed).toBe(true);
    expect(ourSuite2).toBeDefined();
    expect(ourSuite2!.passed).toBe(false);
  });

  it("handles suite that throws", async () => {
    const throwingSuite: ValidationSuite = {
      id: "throwing",
      name: "Throwing Suite",
      version: "1.0.0",
      run: vi.fn(async () => { throw new Error("boom"); }),
    };
    registerSuite(throwingSuite);

    const results = await runAllSuites({});
    const result = results.find(r => r.suiteId === "unknown");
    expect(result).toBeDefined();
    expect(result!.passed).toBe(false);
    expect(result!.findings.some((f: ValidationFinding) => f.severity === "error" && f.message.includes("boom"))).toBe(true);
  });
});

describe("SAST Basic Suite (sast-basic)", () => {
  it("is registered with correct id", () => {
    expect(SAST_BASIC_SUITE.id).toBe("sast-basic");
    expect(SAST_BASIC_SUITE.name).toBe("SAST Basic Security Scan");
  });

  it("detains dangerous patterns: eval", async () => {
    const context = { files: { "src/test.ts": "eval('alert(1)')" } };
    const result = await SAST_BASIC_SUITE.run(context);
    expect(result.passed).toBe(false);
    expect(result.findings.some((f: ValidationFinding) => f.message.includes("eval"))).toBe(true);
  });

  it("detains dangerous patterns: child_process.exec", async () => {
    const context = { files: { "src/test.ts": "child_process.exec('rm -rf /')" } };
    const result = await SAST_BASIC_SUITE.run(context);
    expect(result.passed).toBe(false);
    expect(result.findings.some((f: ValidationFinding) => f.message.includes("Child process"))).toBe(true);
  });

  it("detains dangerous patterns: fs.writeFileSync without validation", async () => {
    const context = { files: { "src/test.ts": "fs.writeFileSync(path, data)" } };
    const result = await SAST_BASIC_SUITE.run(context);
    expect(result.passed).toBe(false);
    expect(result.findings.some((f: ValidationFinding) => f.message.includes("File system write"))).toBe(true);
  });

  it("passes clean code", async () => {
    const context = { files: { "src/test.ts": "const x = 1 + 2;" } };
    const result = await SAST_BASIC_SUITE.run(context);
    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });
});

describe("Perf Thresholds Suite (perf-thresholds)", () => {
  it("is registered with correct id", () => {
    expect(PERF_THRESHOLDS_SUITE.id).toBe("perf-thresholds");
    expect(PERF_THRESHOLDS_SUITE.name).toBe("Performance Thresholds Check");
  });

  it("passes when metrics are within thresholds", async () => {
    const context = {
      metrics: { wallTimeMs: 1000, memoryMB: 50, cpuPercent: 20 },
      thresholds: { wallTimeMs: 5000, memoryMB: 100, cpuPercent: 50 },
    };
    const result = await PERF_THRESHOLDS_SUITE.run(context);
    expect(result.passed).toBe(true);
  });

  it("fails when wallTime exceeds threshold", async () => {
    const context = {
      metrics: { wallTimeMs: 10000, memoryMB: 50, cpuPercent: 20 },
      thresholds: { wallTimeMs: 5000, memoryMB: 100, cpuPercent: 50 },
    };
    const result = await PERF_THRESHOLDS_SUITE.run(context);
    expect(result.passed).toBe(false);
    expect(result.findings.some((f: ValidationFinding) => f.message.includes("Wall time"))).toBe(true);
  });

  it("fails when memory exceeds threshold", async () => {
    const context = {
      metrics: { wallTimeMs: 1000, memoryMB: 200, cpuPercent: 20 },
      thresholds: { wallTimeMs: 5000, memoryMB: 100, cpuPercent: 50 },
    };
    const result = await PERF_THRESHOLDS_SUITE.run(context);
    expect(result.passed).toBe(false);
    expect(result.findings.some((f: ValidationFinding) => f.message.includes("Memory"))).toBe(true);
  });

  it("fails when cpu exceeds threshold", async () => {
    const context = {
      metrics: { wallTimeMs: 1000, memoryMB: 50, cpuPercent: 80 },
      thresholds: { wallTimeMs: 5000, memoryMB: 100, cpuPercent: 50 },
    };
    const result = await PERF_THRESHOLDS_SUITE.run(context);
    expect(result.passed).toBe(false);
    expect(result.findings.some((f: ValidationFinding) => f.message.includes("CPU"))).toBe(true);
  });

  it("passes when no thresholds provided (skips check)", async () => {
    const context = { metrics: { wallTimeMs: 10000, memoryMB: 200, cpuPercent: 80 } };
    const result = await PERF_THRESHOLDS_SUITE.run(context);
    expect(result.passed).toBe(true);
  });
});

describe("Maintainability Metrics Suite (maintainability-metrics)", () => {
  it("is registered with correct id", () => {
    expect(MAINTAINABILITY_METRICS_SUITE.id).toBe("maintainability-metrics");
    expect(MAINTAINABILITY_METRICS_SUITE.name).toBe("Maintainability Metrics Check");
  });

  it("passes when complexity is within threshold", async () => {
    const context = {
      metrics: { cyclomaticComplexity: 5, coupling: 0.3, coverage: 0.85 },
      thresholds: { cyclomaticComplexity: 10, coupling: 0.5, coverage: 0.8 },
    };
    const result = await MAINTAINABILITY_METRICS_SUITE.run(context);
    expect(result.passed).toBe(true);
  });

  it("fails when cyclomatic complexity exceeds threshold", async () => {
    const context = {
      metrics: { cyclomaticComplexity: 20, coupling: 0.3, coverage: 0.85 },
      thresholds: { cyclomaticComplexity: 10, coupling: 0.5, coverage: 0.8 },
    };
    const result = await MAINTAINABILITY_METRICS_SUITE.run(context);
    expect(result.passed).toBe(false);
    expect(result.findings.some((f: ValidationFinding) => f.message.includes("Cyclomatic"))).toBe(true);
  });

  it("fails when coupling exceeds threshold", async () => {
    const context = {
      metrics: { cyclomaticComplexity: 5, coupling: 0.8, coverage: 0.85 },
      thresholds: { cyclomaticComplexity: 10, coupling: 0.5, coverage: 0.8 },
    };
    const result = await MAINTAINABILITY_METRICS_SUITE.run(context);
    expect(result.passed).toBe(false);
    expect(result.findings.some((f: ValidationFinding) => f.message.includes("Coupling"))).toBe(true);
  });

  it("fails when coverage below threshold", async () => {
    const context = {
      metrics: { cyclomaticComplexity: 5, coupling: 0.3, coverage: 0.5 },
      thresholds: { cyclomaticComplexity: 10, coupling: 0.5, coverage: 0.8 },
    };
    const result = await MAINTAINABILITY_METRICS_SUITE.run(context);
    expect(result.passed).toBe(false);
    expect(result.findings.some((f: ValidationFinding) => f.message.includes("coverage"))).toBe(true);
  });

  it("passes when no thresholds provided", async () => {
    const context = { metrics: { cyclomaticComplexity: 50, coupling: 0.9, coverage: 0.1 } };
    const result = await MAINTAINABILITY_METRICS_SUITE.run(context);
    expect(result.passed).toBe(true);
  });
});