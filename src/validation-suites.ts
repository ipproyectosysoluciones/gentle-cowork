/**
 * Phase 7 Slice 7.4 — Validation Suites
 *
 * Pluggable validation suites for the verifier. Each suite implements
 * a ValidationSuite interface and is registered in a global registry.
 * The verifier runs all suites declared in the contract.
 */

/** Result of running a validation suite. */
export interface ValidationResult {
  /** The suite that produced this result. */
  suiteId: string;
  /** Whether the suite passed. */
  passed: boolean;
  /** Individual findings from the suite. */
  findings: ValidationFinding[];
  /** Optional metadata (duration, etc.). */
  metadata?: Record<string, unknown>;
}

/** A single finding from a validation suite. */
export interface ValidationFinding {
  /** Unique identifier for this finding. */
  id: string;
  /** Severity level. */
  severity: "info" | "warning" | "error";
  /** Human-readable message. */
  message: string;
  /** Optional location (file:line). */
  location?: string;
  /** Optional suggestion for fixing. */
  suggestion?: string;
}

/** A validation suite that can be run against a codebase/context. */
export interface ValidationSuite {
  /** Unique identifier (e.g., "sast-basic"). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Version of the suite. */
  version: string;
  /**
   * Runs the suite against the given context.
   * Context shape depends on the suite (files, metrics, thresholds, etc.)
   */
  run(context: ValidationContext): Promise<ValidationResult>;
}

/** Context passed to validation suites. Shape depends on the suite. */
export interface ValidationContext {
  /** File contents for static analysis (SAST). */
  files?: Record<string, string>;
  /** Metrics for performance/maintainability suites. */
  metrics?: {
    wallTimeMs?: number;
    memoryMB?: number;
    cpuPercent?: number;
    cyclomaticComplexity?: number;
    coupling?: number;
    coverage?: number;
  };
  /** Thresholds for threshold-based suites. */
  thresholds?: {
    wallTimeMs?: number;
    memoryMB?: number;
    cpuPercent?: number;
    cyclomaticComplexity?: number;
    coupling?: number;
    coverage?: number;
  };
  /** Arbitrary additional data. */
  [key: string]: unknown;
}

/** Global registry of validation suites. */
const suiteRegistry = new Map<string, ValidationSuite>();

/** Registers a validation suite. Throws if already registered. */
export function registerSuite(suite: ValidationSuite): void {
  if (suiteRegistry.has(suite.id)) {
    throw new Error(`Validation suite already registered: ${suite.id}`);
  }
  suiteRegistry.set(suite.id, suite);
}

/** Retrieves a suite by ID. */
export function getSuite(id: string): ValidationSuite | undefined {
  return suiteRegistry.get(id);
}

/** Lists all registered suite IDs. */
export function listSuites(): string[] {
  return Array.from(suiteRegistry.keys());
}

/** Runs all registered suites and returns their results. */
export async function runAllSuites(context: ValidationContext): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  for (const suite of suiteRegistry.values()) {
    try {
      const result = await suite.run(context);
      // result already contains suiteId from the suite's run method
      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        suiteId: "unknown",
        passed: false,
        findings: [{ id: "suite-error", severity: "error", message: `Suite threw: ${message}` }],
      });
    }
  }
  return results;
}

/**
 * SAST Basic Security Suite
 * Detects common dangerous patterns in source code.
 */
export const SAST_BASIC_SUITE: ValidationSuite = {
  id: "sast-basic",
  name: "SAST Basic Security Scan",
  version: "1.0.0",
  async run(context: ValidationContext): Promise<ValidationResult> {
    const findings: ValidationFinding[] = [];

    if (!context.files) {
      return { suiteId: "sast-basic", passed: true, findings: [] };
    }

    const dangerousPatterns = [
      { pattern: /\beval\s*\(/g, message: "Use of eval() is dangerous", suggestion: "Avoid eval; use JSON.parse or safe alternatives" },
      { pattern: /\bchild_process\.(exec|spawn|execSync|spawnSync)\s*\(/g, message: "Child process execution detected", suggestion: "Avoid shell execution; use safe APIs" },
      { pattern: /\bfs\.(writeFileSync|writeFile|appendFileSync|appendFile)\s*\(/g, message: "File system write detected", suggestion: "Validate path and content before writing" },
      { pattern: /\brequire\s*\(\s*["']child_process["']\s*\)/g, message: "Dynamic require of child_process", suggestion: "Avoid dynamic requires" },
      { pattern: /\bnew\s+Function\s*\(/g, message: "Dynamic function creation (new Function)", suggestion: "Avoid dynamic code generation" },
      { pattern: /\bsetTimeout\s*\(\s*["']/g, message: "String argument to setTimeout (code injection risk)", suggestion: "Pass function reference instead of string" },
      { pattern: /\bsetInterval\s*\(\s*["']/g, message: "String argument to setInterval (code injection risk)", suggestion: "Pass function reference instead of string" },
    ];

    for (const [filePath, content] of Object.entries(context.files)) {
      for (const { pattern, message, suggestion } of dangerousPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const lineNumber = content.substring(0, match.index).split("\n").length;
          findings.push({
            id: `sast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            severity: "error",
            message,
            location: `${filePath}:${lineNumber}`,
            suggestion,
          });
        }
      }
    }

    return {
      suiteId: "sast-basic",
      passed: findings.length === 0,
      findings,
    };
  },
};

/**
 * Performance Thresholds Suite
 * Checks runtime metrics against declared thresholds.
 */
export const PERF_THRESHOLDS_SUITE: ValidationSuite = {
  id: "perf-thresholds",
  name: "Performance Thresholds Check",
  version: "1.0.0",
  async run(context: ValidationContext): Promise<ValidationResult> {
    const findings: ValidationFinding[] = [];

    const metrics = context.metrics;
    const thresholds = context.thresholds;

    if (!metrics || !thresholds) {
      return { suiteId: "perf-thresholds", passed: true, findings: [] };
    }

    const checks: Array<{ key: keyof typeof metrics; label: string; unit: string }> = [
      { key: "wallTimeMs", label: "Wall time", unit: "ms" },
      { key: "memoryMB", label: "Memory", unit: "MB" },
      { key: "cpuPercent", label: "CPU usage", unit: "%" },
    ];

    for (const check of checks) {
      const metricValue = metrics[check.key];
      const thresholdValue = thresholds[check.key];
      if (metricValue !== undefined && thresholdValue !== undefined) {
        if (metricValue > thresholdValue) {
          findings.push({
            id: `perf-${check.key}-${Date.now()}`,
            severity: "error",
            message: `${check.label} (${metricValue}${check.unit}) exceeds threshold (${thresholdValue}${check.unit})`,
            suggestion: `Optimize ${check.label.toLowerCase()} or increase threshold in contract`,
          });
        }
      }
    }

    return {
      suiteId: "perf-thresholds",
      passed: findings.length === 0,
      findings,
    };
  },
};

/**
 * Maintainability Metrics Suite
 * Checks code quality metrics against thresholds.
 */
export const MAINTAINABILITY_METRICS_SUITE: ValidationSuite = {
  id: "maintainability-metrics",
  name: "Maintainability Metrics Check",
  version: "1.0.0",
  async run(context: ValidationContext): Promise<ValidationResult> {
    const findings: ValidationFinding[] = [];

    const metrics = context.metrics;
    const thresholds = context.thresholds;

    if (!metrics || !thresholds) {
      return { suiteId: "maintainability-metrics", passed: true, findings: [] };
    }

    const checks: Array<{ key: keyof typeof metrics; label: string; higherIsWorse: boolean }> = [
      { key: "cyclomaticComplexity", label: "Cyclomatic complexity", higherIsWorse: true },
      { key: "coupling", label: "Coupling", higherIsWorse: true },
      { key: "coverage", label: "Test coverage", higherIsWorse: false },
    ];

    for (const check of checks) {
      const metricValue = metrics[check.key];
      const thresholdValue = thresholds[check.key];
      if (metricValue !== undefined && thresholdValue !== undefined) {
        const exceeded = check.higherIsWorse
          ? metricValue > thresholdValue
          : metricValue < thresholdValue;
        if (exceeded) {
          findings.push({
            id: `maint-${check.key}-${Date.now()}`,
            severity: "error",
            message: `${check.label} (${metricValue}) ${check.higherIsWorse ? "exceeds" : "below"} threshold (${thresholdValue})`,
            suggestion: `Refactor to improve ${check.label.toLowerCase()} or adjust threshold in contract`,
          });
        }
      }
    }

    return {
      suiteId: "maintainability-metrics",
      passed: findings.length === 0,
      findings,
    };
  },
};

// Auto-register base suites
registerSuite(SAST_BASIC_SUITE);
registerSuite(PERF_THRESHOLDS_SUITE);
registerSuite(MAINTAINABILITY_METRICS_SUITE);