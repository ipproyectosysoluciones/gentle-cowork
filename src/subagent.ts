/**
 * gentle-cowork — shared subagent transport.
 *
 * One subagent turn = one fresh `pi --mode rpc` child process with a
 * clean context. Each role receives its instructions as the user prompt
 * and must return structured JSON; no role's conversation leaks into
 * another role's context. The transport is injectable so the extension
 * and its tests stay decoupled from process spawning.
 */

import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RpcClient } from "@earendil-works/pi-coding-agent";

/** The minimal RpcClient surface a subagent turn needs (injectable for tests). */
export interface SubagentRpc {
  /** Start the RPC child process. */
  start(): Promise<void>;
  /**
   * Send one prompt and wait for the run to settle.
   * @param message The user prompt for the subagent.
   * @param timeoutMs Optional overall timeout in milliseconds.
   */
  promptAndWait(message: string, timeoutMs?: number): Promise<unknown>;
  /** Text of the subagent's final assistant message, or null. */
  getLastAssistantText(): Promise<string | null>;
  /** Stop the RPC child process. Always called by runSubagentTurn. */
  stop(): Promise<void>;
}

/** Thrown when a subagent's response cannot be parsed into its contract. */
export class SubagentProtocolError extends Error {
  readonly rawResponse: string;

  constructor(message: string, rawResponse: string) {
    super(message);
    this.name = "SubagentProtocolError";
    this.rawResponse = rawResponse;
  }
}

/**
 * Extracts the first balanced JSON block in a text — an object `{...}` or
 * an array `[...]` — or null. Array top-level matters for the planner,
 * which returns a JSON array of steps.
 */
export function extractJsonBlock(text: string): string | null {
  const objIndex = text.indexOf("{");
  const arrIndex = text.indexOf("[");
  if (objIndex === -1 && arrIndex === -1) return null;
  let start: number;
  let closer: string;
  if (objIndex === -1 || (arrIndex !== -1 && arrIndex < objIndex)) {
    start = arrIndex;
    closer = "]";
  } else {
    start = objIndex;
    closer = "}";
  }
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
    else if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0 && ch === closer) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Back-compat alias for Phase 1 callers: the first balanced JSON block. */
export const extractJsonObject = extractJsonBlock;

/** Options for spawning a subagent child process. */
export interface SubagentSpawnOptions {
  /** Working directory for the subagent child process. */
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
 * subagent child uses the same installation as its parent.
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
    // import.meta.resolve honors the package's "import" export condition; a
    // CJS require.resolve fails here with ERR_PACKAGE_PATH_NOT_EXPORTED.
    const packageRoot = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
    for (const candidate of [join(packageRoot, "cli.js"), join(packageRoot, "bundle", "cli.js")]) {
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // Not resolvable from this extension's location.
  }
  throw new Error(
    "gentle-cowork could not locate the pi CLI entry to spawn the subagent. " +
      "Pass cliPath explicitly in SubagentSpawnOptions.",
  );
}

/** Creates a subagent transport: a `pi --mode rpc` child process. */
export function createRpcSubagent(options: SubagentSpawnOptions = {}): SubagentRpc {
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

/**
 * Runs one full subagent turn: start → prompt → last assistant text →
 * stop. The client is always stopped. Returns null when the subagent
 * produced no assistant text; callers turn that into their own protocol
 * error.
 */
export async function runSubagentTurn(
  prompt: string,
  rpc: SubagentRpc,
  timeoutMs?: number,
): Promise<string | null> {
  let raw: string | null;
  await rpc.start();
  try {
    await rpc.promptAndWait(prompt, timeoutMs);
    raw = await rpc.getLastAssistantText();
  } finally {
    await rpc.stop();
  }
  return raw;
}
