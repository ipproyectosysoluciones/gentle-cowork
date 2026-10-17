/**
 * gentle-cowork — Phase 1: single-role verification.
 *
 * Spawns a cowork-verifier subagent as a Pi RPC child process
 * (`pi --mode rpc`), sends it a verification prompt, and parses its
 * structured APPROVE/CHANGES verdict per ODD spec requirement (S#).
 * The transport is injectable so the extension and its tests stay
 * decoupled from process spawning.
 */

import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { RpcClient } from "@earendil-works/pi-coding-agent";

import type { VerifyVerdict } from "./types.ts";

/** The minimal RpcClient surface runVerifier needs (injectable for tests). */
export interface VerifierRpc {
  /** Start the RPC child process. */
  start(): Promise<void>;
  /**
   * Send one prompt and wait for the run to settle.
   * @param message The user prompt for the verifier.
   * @param timeoutMs Optional overall timeout in milliseconds.
   */
  promptAndWait(message: string, timeoutMs?: number): Promise<unknown>;
  /** Text of the verifier's final assistant message, or null. */
  getLastAssistantText(): Promise<string | null>;
  /** Stop the RPC child process. Always called by runVerifier. */
  stop(): Promise<void>;
}

/** Thrown when the verifier's response cannot be parsed into a verdict. */
export class VerifierProtocolError extends Error {
  readonly rawResponse: string;

  constructor(message: string, rawResponse: string) {
    super(message);
    this.name = "VerifierProtocolError";
    this.rawResponse = rawResponse;
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

/** Extracts the first balanced JSON object found in a text, or null. */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
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
  rpc: VerifierRpc;
  timeoutMs?: number;
}

/**
 * Runs one verification through an RPC transport:
 * start → prompt → parse verdict → stop. The client is always stopped.
 */
export async function runVerifier(request: VerifierRequest): Promise<VerifyVerdict> {
  const { prompt, contractId, rpc, timeoutMs } = request;
  let raw: string | null;
  await rpc.start();
  try {
    await rpc.promptAndWait(prompt, timeoutMs);
    raw = await rpc.getLastAssistantText();
  } finally {
    await rpc.stop();
  }
  if (raw === null) {
    throw new VerifierProtocolError("cowork-verifier returned no assistant text", "");
  }
  return parseVerdict(contractId, raw);
}

/** Options for spawning the production RPC transport. */
export interface VerifierSpawnOptions {
  /** Working directory for the verifier child process. */
  cwd?: string;
  /** Provider override; defaults to the child's own configuration. */
  provider?: string;
  /** Model override; defaults to the child's own configuration. */
  model?: string;
  /** Explicit CLI entry path; defaults to the running pi's own cli.js. */
  cliPath?: string;
  /** Extra CLI arguments for the child process. */
  extraArgs?: string[];
}

/**
 * Resolves the CLI entry of the pi process running this extension, so the
 * verifier child uses the same installation as its parent.
 *
 * `process.argv[1]` is the symlink path (for example /usr/local/bin/pi) when
 * pi is launched from PATH, so it is resolved with realpath first. If the
 * running entry cannot be validated, falls back to the package installed
 * next to this extension. Never returns a relative path: a relative CLI path
 * is resolved against the child's cwd and breaks the spawn.
 */
function resolveDefaultCliPath(): string {
  const argv1 = process.argv[1] ?? "";
  if (argv1.length > 0) {
    try {
      const real = realpathSync(argv1);
      if (real.endsWith("cli.js") && real.includes("@earendil-works")) return real;
    } catch {
      // argv[1] may not exist on disk (embedded hosts); try the package next.
    }
  }
  try {
    const require = createRequire(import.meta.url);
    const packageRoot = dirname(require.resolve("@earendil-works/pi-coding-agent"));
    for (const candidate of [join(packageRoot, "cli.js"), join(packageRoot, "bundle", "cli.js")]) {
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // Not resolvable from this extension's location.
  }
  throw new Error(
    "gentle-cowork could not locate the pi CLI entry to spawn the verifier. " +
      "Pass cliPath explicitly in VerifierSpawnOptions.",
  );
}

/** Creates the production verifier transport: a `pi --mode rpc` child. */
export function createRpcVerifier(options: VerifierSpawnOptions = {}): VerifierRpc {
  const client = new RpcClient({
    cliPath: options.cliPath ?? resolveDefaultCliPath(),
    cwd: options.cwd,
    provider: options.provider,
    model: options.model,
    args: ["--no-session", ...(options.extraArgs ?? [])],
  });
  return {
    start: () => client.start(),
    promptAndWait: (message, timeoutMs) => client.promptAndWait(message, undefined, timeoutMs),
    getLastAssistantText: () => client.getLastAssistantText(),
    stop: () => client.stop(),
  };
}
