/**
 * Phase 6.4: Budget guards evaluation for the oracle.
 *
 * Takes a contract's declared budget and current usage, evaluates each
 * dimension against configurable thresholds, and returns a structured verdict
 * the master can act on: continue, warn+escalate, pause+escalate, or soft degrade.
 *
 * Thresholds are configurable; defaults are warning at 80%, pause at 100%.
 * The contract can override the action on exceeded via its `onExceeded` field
 * (soft degrade = "degrade" instead of "pause+escalate").
 */

import type { Budget, BudgetLimit } from "./schema.ts";

/** Per-dimension evaluation result. */
export interface GuardResult {
  /** The evaluated state: ok | warning | exceeded | unknown. */
  state: "ok" | "warning" | "exceeded" | "unknown";
  /** The ratio measured/limit; null when limit or measured is unknown. */
  ratio: number | null;
  /** The action to take: continue | escalate | pause+escalate | degrade. */
  action: "continue" | "escalate" | "pause+escalate" | "degrade";
}

/** Full guards evaluation across all budget dimensions. */
export interface GuardsEvaluation {
  modelCalls: GuardResult;
  tokens: GuardResult;
  wallTime: GuardResult;
}

/** Configuration for the guards evaluation. */
export interface GuardConfig {
  /** Ratio threshold for warning (default 0.8 = 80%). */
  warningThreshold: number;
  /** Ratio threshold for pause (default 1.0 = 100%). */
  pauseThreshold: number;
  /** Action when exceeded: "pause+escalate" (default) or "degrade" (soft). */
  onExceeded: "pause+escalate" | "degrade";
  /** Action when warning: "escalate" (default) or "continue". */
  onWarning: "escalate" | "continue";
}

/** Computes the ratio measured/limit, returning null if unknown. */
function computeRatio(limit: BudgetLimit): number | null {
  if (limit.limit === null || limit.measured === null) return null;
  if (limit.limit === 0) return 0;
  return limit.measured / limit.limit;
}

/** Determines state and action from ratio and config. */
function evaluateDimension(
  limit: BudgetLimit,
  config: GuardConfig,
): GuardResult {
  const ratio = computeRatio(limit);
  if (ratio === null) {
    return { state: "unknown", ratio: null, action: "continue" };
  }
  if (ratio >= config.pauseThreshold) {
    return {
      state: "exceeded",
      ratio,
      action: config.onExceeded === "degrade" ? "degrade" : "pause+escalate",
    };
  }
  if (ratio >= config.warningThreshold) {
    return {
      state: "warning",
      ratio,
      action: config.onWarning === "continue" ? "continue" : "escalate",
    };
  }
  return { state: "ok", ratio, action: "continue" };
}

/**
 * Evaluates all three budget dimensions against the contract's budget and the
 * given guard configuration. Returns a structured verdict for the master to
 * act on (pause, escalate, continue, degrade).
 */
export function evaluateGuards(
  budget: Budget,
  config: GuardConfig,
): GuardsEvaluation {
  return {
    modelCalls: evaluateDimension(budget.modelCalls, config),
    tokens: evaluateDimension(budget.tokens, config),
    wallTime: evaluateDimension(budget.wallTime, config),
  };
}