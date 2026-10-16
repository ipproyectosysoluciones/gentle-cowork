/**
 * gentle-cowork — Phase 2 roles: planner, implementer, and the chain.
 *
 * cowork-planner decomposes an objective into the fewest independently
 * verifiable steps (read-only). cowork-implementer executes exactly ONE
 * step within its allowed scope. The chain orchestrates
 * plan → implement → verify per step, retrying the implementer after a
 * CHANGES verdict (max 3 retries per ROADMAP), and stops at the first
 * step that exhausts its retries.
 */

import {
  SubagentProtocolError,
  extractJsonBlock,
  runSubagentTurn,
  type SubagentRpc,
  type SubagentSpawnOptions,
} from "./subagent.ts";
import { runVerifier } from "./verifier.ts";
import type { VerifyVerdict } from "./types.ts";

/** A single plan step produced by cowork-planner. */
export interface PlanStep {
  step: number;
  objective: string;
  scope: string[];
  acceptanceCriteria: string[];
}

/** The artifact summary produced by cowork-implementer after one step. */
export interface ImplementerArtifact {
  filesModified: string[];
  changesSummary: string;
  stepsCompleted: string[];
  notes?: string;
}

/**
 * The Phase 2 exit-criteria objective: a complete chain cycle over a
 * small, concrete, non-destructive repository change.
 */
export const PHASE2_TEST_OBJECTIVE =
  "Create the file docs/phase2-demo.md with exactly one line of content: 'gentle-cowork phase 2 demo'. Nothing else in the file.";

// ── cowork-planner ──────────────────────────────────────────────────────────

/** Builds the cowork-planner prompt for one objective. */
export function buildPlanPrompt(objective: string, specRef: string): string {
  return [
    "You are cowork-planner, a read-only planning agent. You never write, edit, or modify files.",
    "",
    `ODD spec reference (read it fully, up to its "## Log" section): ${specRef}`,
    "",
    `Objective: ${objective}`,
    "",
    "Decompose the objective into the FEWEST independently verifiable steps.",
    "",
    "Rules:",
    "- Each step must name the exact files it may touch (scope) and its acceptance criteria.",
    "- Steps run in order; each one is executed by a separate implementer agent.",
    "- Keep the plan minimal — no steps that are not strictly needed.",
    "",
    "Respond with ONLY a JSON array in this exact shape — no prose, no markdown fences:",
    JSON.stringify([
      {
        step: 1,
        objective: "what this step does",
        scope: ["src/path/file.ts"],
        acceptanceCriteria: ["criterion that can be verified by reading or testing"],
      },
    ]),
  ].join("\n");
}

/** Parses and validates a cowork-planner response into PlanSteps. */
export function parsePlan(raw: string): PlanStep[] {
  const jsonText = extractJsonBlock(raw);
  if (!jsonText) {
    throw new SubagentProtocolError("cowork-planner response contains no JSON object", raw);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new SubagentProtocolError(`cowork-planner JSON is malformed: ${(error as Error).message}`, raw);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new SubagentProtocolError("cowork-planner response must be a non-empty JSON array of steps", raw);
  }
  return parsed.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new SubagentProtocolError(`plan entry ${index + 1} is not an object`, raw);
    }
    const entry = item as Record<string, unknown>;
    const objective = typeof entry.objective === "string" ? entry.objective.trim() : "";
    if (objective.length === 0) {
      throw new SubagentProtocolError(`plan step ${index + 1} has an empty objective`, raw);
    }
    const scope = Array.isArray(entry.scope)
      ? entry.scope.filter((path): path is string => typeof path === "string" && path.length > 0)
      : [];
    if (scope.length === 0) {
      throw new SubagentProtocolError(`plan step ${index + 1} has an empty scope`, raw);
    }
    const acceptanceCriteria = Array.isArray(entry.acceptanceCriteria)
      ? entry.acceptanceCriteria.filter(
          (criterion): criterion is string => typeof criterion === "string" && criterion.length > 0,
        )
      : [];
    // Planner step numbers are informational; the array order is authoritative.
    return { step: index + 1, objective, scope, acceptanceCriteria };
  });
}

// ── cowork-implementer ─────────────────────────────────────────────────────

/** Builds the cowork-implementer prompt for ONE plan step. */
export function buildImplementPrompt(step: PlanStep, specRef: string): string {
  return [
    "You are cowork-implementer, a scoped code writer. You execute exactly ONE plan step.",
    "",
    `ODD spec reference (read it fully, up to its "## Log" section): ${specRef}`,
    "",
    `Step ${step.step}: ${step.objective}`,
    `Allowed scope (only modify files here): ${step.scope.join(", ")}`,
    "",
    "Rules:",
    "- Read the spec by reference before editing.",
    "- Only modify files within the allowed scope.",
    "- Keep changes minimal and focused on this single step.",
    "- If the task is unclear, report it in the artifact notes — do not guess.",
    "",
    "When done, respond with ONLY a JSON object in this exact shape — no prose, no markdown fences:",
    JSON.stringify({
      filesModified: ["src/path/file.ts"],
      changesSummary: "what changed and why",
      stepsCompleted: ["what was done"],
      notes: "any deviations or concerns",
    }),
  ].join("\n");
}

/** Parses and validates a cowork-implementer artifact summary. */
export function parseArtifact(raw: string): ImplementerArtifact {
  const jsonText = extractJsonBlock(raw);
  if (!jsonText) {
    throw new SubagentProtocolError("cowork-implementer response contains no JSON object", raw);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new SubagentProtocolError(`cowork-implementer JSON is malformed: ${(error as Error).message}`, raw);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new SubagentProtocolError("cowork-implementer response is not a JSON object", raw);
  }
  const value = parsed as Record<string, unknown>;
  if (!Array.isArray(value.filesModified) || value.filesModified.some((x) => typeof x !== "string")) {
    throw new SubagentProtocolError("cowork-implementer artifact has an invalid filesModified array", raw);
  }
  if (typeof value.changesSummary !== "string" || value.changesSummary.length === 0) {
    throw new SubagentProtocolError("cowork-implementer artifact is missing changesSummary", raw);
  }
  const stepsCompleted = Array.isArray(value.stepsCompleted)
    ? value.stepsCompleted.filter((x): x is string => typeof x === "string")
    : [];
  const notes = typeof value.notes === "string" ? value.notes : undefined;
  return {
    filesModified: value.filesModified as string[],
    changesSummary: value.changesSummary,
    stepsCompleted,
    notes,
  };
}

// ── step verification ───────────────────────────────────────────────────────

/** Builds the cowork-verifier prompt for one implemented step. */
export function buildStepVerifyPrompt(
  contractId: string,
  step: PlanStep,
  artifact: ImplementerArtifact,
  specRef: string,
): string {
  const criteria = step.acceptanceCriteria.map((criterion, index) => `  - C${index + 1}: ${criterion}`);
  return [
    "You are cowork-verifier, a read-only verification agent. You never write, edit, or modify files.",
    "",
    `ODD spec reference (read it for context, up to its "## Log" section): ${specRef}`,
    "",
    `You are verifying step ${step.step}: ${step.objective}`,
    `Allowed scope for this step: ${step.scope.join(", ")}`,
    "",
    "Implementer artifact summary:",
    JSON.stringify(artifact, null, 2),
    "",
    "Verify each acceptance criterion for this step:",
    ...criteria,
    "",
    "Rules:",
    "- Inspect the current repository state and the files the artifact claims to have modified.",
    "- Run the project's tests if they exist and are relevant to the step.",
    '- Evidence must cite what you actually read or ran (file path, content, or command output).',
    '- "APPROVE" only when every criterion passes; "CHANGES" if any fails.',
    "",
    "Respond with ONLY a JSON object in this exact shape — no prose, no markdown fences:",
    JSON.stringify({
      contractId,
      requirements: [{ id: "C#", verdict: "pass|fail|untested", evidence: "concrete evidence" }],
      outcome: "APPROVE|CHANGES",
      report: "overall explanation",
    }),
  ].join("\n");
}

// ── role runners ───────────────────────────────────────────────────────────

/** Runs cowork-planner for one objective and returns its plan. */
export async function runPlanner(
  objective: string,
  specRef: string,
  rpc: SubagentRpc,
  timeoutMs?: number,
): Promise<PlanStep[]> {
  const raw = await runSubagentTurn(buildPlanPrompt(objective, specRef), rpc, timeoutMs);
  if (raw === null) {
    throw new SubagentProtocolError("cowork-planner returned no assistant text", "");
  }
  return parsePlan(raw);
}

/** Runs cowork-implementer for one step and returns its artifact summary. */
export async function runImplementer(
  step: PlanStep,
  specRef: string,
  rpc: SubagentRpc,
  timeoutMs?: number,
): Promise<ImplementerArtifact> {
  const raw = await runSubagentTurn(buildImplementPrompt(step, specRef), rpc, timeoutMs);
  if (raw === null) {
    throw new SubagentProtocolError("cowork-implementer returned no assistant text", "");
  }
  return parseArtifact(raw);
}

// ── the chain ──────────────────────────────────────────────────────────────

/** Dependencies for running a chain; the transport is injectable. */
export interface ChainDeps {
  /** Creates a fresh subagent transport per role turn. */
  connect: (options: SubagentSpawnOptions) => SubagentRpc;
  /** Spawn options (cwd, provider, model) inherited from the session. */
  spawnOptions: SubagentSpawnOptions;
  /** Per-turn timeout in milliseconds. */
  timeoutMs?: number;
  /** Maximum implementer attempts per step after CHANGES verdicts. */
  maxRetries: number;
}

/** The outcome of one step through the implement → verify cycle. */
export interface StepResult {
  step: number;
  attempts: number;
  artifact?: ImplementerArtifact;
  verdict?: VerifyVerdict;
  status: "completed" | "failed";
}

/** The outcome of a full planner → implementer → verifier chain run. */
export interface ChainResult {
  plan: PlanStep[];
  steps: StepResult[];
  status: "completed" | "failed";
}

/**
 * Runs the full chain for one objective: plan, then for each step
 * implement → verify, retrying the implementer after a CHANGES verdict up
 * to deps.maxRetries times. The chain stops at the first step that
 * exhausts its retries.
 */
export async function runChain(
  objective: string,
  specRef: string,
  deps: ChainDeps,
  onProgress?: (line: string) => void,
): Promise<ChainResult> {
  const progress = onProgress ?? (() => {});
  const plan = await runPlanner(objective, specRef, deps.connect(deps.spawnOptions), deps.timeoutMs);
  progress(`cowork-planner returned ${plan.length} step${plan.length === 1 ? "" : "s"}`);

  const steps: StepResult[] = [];
  for (const step of plan) {
    const contractId = `cc-${step.step}`;
    let result: StepResult = { step: step.step, attempts: 0, status: "failed" };

    for (let attempt = 1; attempt <= deps.maxRetries; attempt++) {
      progress(`step ${step.step}: cowork-implementer attempt ${attempt}`);
      const artifact = await runImplementer(step, specRef, deps.connect(deps.spawnOptions), deps.timeoutMs);

      const verdict = await runVerifier({
        prompt: buildStepVerifyPrompt(contractId, step, artifact, specRef),
        contractId,
        rpc: deps.connect(deps.spawnOptions),
        timeoutMs: deps.timeoutMs,
      });

      result = {
        step: step.step,
        attempts: attempt,
        artifact,
        verdict,
        status: verdict.outcome === "APPROVE" ? "completed" : "failed",
      };

      if (verdict.outcome === "APPROVE") {
        progress(`step ${step.step}: cowork-verifier APPROVE`);
        break;
      }
      progress(`step ${step.step}: cowork-verifier CHANGES (attempt ${attempt})`);
    }

    steps.push(result);
    if (result.status === "failed") {
      return { plan, steps, status: "failed" };
    }
  }
  return { plan, steps, status: "completed" };
}
