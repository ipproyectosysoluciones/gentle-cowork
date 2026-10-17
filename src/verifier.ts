/**
 * gentle-cowork — Phase 1: single-role verification.
 *
 * Spawns a cowork-verifier subagent as a Pi RPC child process
 * (`pi --mode rpc`), sends it a verification prompt, and parses its
 * structured APPROVE/CHANGES verdict per ODD spec requirement (S#).
 * The transport is injectable so the extension and its tests stay
 * decoupled from process spawning.
 */

import {
  extractJsonObject,
  runSubagentTurn,
  SubagentProtocolError,
  type SubagentRpc,
} from "./subagent.ts";

import type { VerifyVerdict } from "./types.ts";

export { extractJsonObject };

/** Thrown when the verifier's response cannot be parsed into a verdict. */
export class VerifierProtocolError extends SubagentProtocolError {
  constructor(message: string, rawResponse: string) {
    super(message, rawResponse);
    this.name = "VerifierProtocolError";
  }
}

/** One verifiable requirement (an S# from the ODD spec document). */
export interface VerifyRequirement {
  id: string;
  text: string;
}

/** The verdict values a single requirement may take. */
const REQUIREMENT_VERDICTS = new Set(["pass", "fail", "untested"]);

/**
 * The Phase 1 exit-criteria test: the verifier reads a real repository
 * file (src/types.ts) and returns a structured verdict for each S#.
 */
export const PHASE1_TEST_REQUIREMENTS: readonly VerifyRequirement[] = [
  {
    id: "S1",
    text: "The file src/types.ts exports a TaskContract interface including a specRef field of type string.",
  },
  {
    id: "S2",
    text: "The file src/types.ts exports a CoworkRole type with exactly the values 'planner', 'implementer', and 'verifier'.",
  },
];

/** Builds the cowork-verifier prompt for one verification run. */
export function buildVerifyPrompt(
  contractId: string,
  specRef: string,
  requirements: readonly VerifyRequirement[],
): string {
  const requirementLines = requirements.map((r) => `- ${r.id}: ${r.text}`).join("\n");
  return [
    "You are cowork-verifier, a read-only verification agent. You never write, edit, or modify files.",
    "",
    `ODD spec reference (read it for context, up to its "## Log" section): ${specRef}`,
    "",
    "Verify each requirement below by reading the repository files it names.",
    "",
    "Requirements:",
    requirementLines,
    "",
    "Rules:",
    '- Give a verdict per requirement: "pass", "fail", or "untested" (with a concrete reason).',
    "- Evidence must cite what you actually read (file path, symbol, or line content).",
    '- "APPROVE" only when every requirement passes; "CHANGES" if any fails.',
    "",
    "Respond with ONLY a JSON object in this exact shape — no prose, no markdown fences:",
    JSON.stringify({
      contractId,
      requirements: [{ id: "S#", verdict: "pass|fail|untested", evidence: "concrete evidence" }],
      outcome: "APPROVE|CHANGES",
      report: "overall explanation",
    }),
  ].join("\n");
}

function isRequirementShaped(value: unknown): value is VerifyVerdict["requirements"][number] {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.evidence === "string" &&
    typeof r.verdict === "string" &&
    REQUIREMENT_VERDICTS.has(r.verdict)
  );
}

function isVerdictShaped(value: unknown): value is VerifyVerdict {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.contractId === "string" &&
    (v.outcome === "APPROVE" || v.outcome === "CHANGES") &&
    typeof v.report === "string" &&
    Array.isArray(v.requirements) &&
    v.requirements.every(isRequirementShaped)
  );
}

/** Parses and validates a raw verifier response into a VerifyVerdict. */
export function parseVerdict(contractId: string, raw: string): VerifyVerdict {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    throw new VerifierProtocolError("cowork-verifier response contains no JSON object", raw);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new VerifierProtocolError(`cowork-verifier JSON is malformed: ${(error as Error).message}`, raw);
  }
  if (!isVerdictShaped(parsed)) {
    throw new VerifierProtocolError("cowork-verifier response does not match the verdict contract", raw);
  }
  if (parsed.contractId !== contractId) {
    throw new VerifierProtocolError(
      `cowork-verifier response has contractId "${parsed.contractId}", expected "${contractId}"`,
      raw,
    );
  }
  return parsed;
}

/** Everything one verification run needs. */
export interface VerifierRequest {
  prompt: string;
  contractId: string;
  rpc: SubagentRpc;
  timeoutMs?: number;
}

/**
 * Runs one verification through an RPC transport:
 * start → prompt → parse verdict → stop. The client is always stopped.
 */
export async function runVerifier(request: VerifierRequest): Promise<VerifyVerdict> {
  const { prompt, contractId, rpc, timeoutMs } = request;
  const raw = await runSubagentTurn(prompt, rpc, timeoutMs);
  if (raw === null) {
    throw new VerifierProtocolError("cowork-verifier returned no assistant text", "");
  }
  return parseVerdict(contractId, raw);
}
