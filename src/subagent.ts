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
  /**
   * Cheap state poll used as the readiness handshake (BLA-26). Optional:
   * transports that cannot poll state rely on the client's own send-timeout
   * window for the first prompt.
   */
  getState?(): Promise<unknown>;
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
  /** Working directory for the subagent child process. Must be an absolute path within allowed roots. */
  cwd?: string;
  /** Provider override; must match allowed provider pattern. */
  provider?: string;
  /** Model override; must match allowed model pattern. */
  model?: string;
  /** Explicit CLI entry path; must be an absolute path to a known pi CLI. */
  cliPath?: string;
  /** Extra CLI arguments for the child process; restricted list. */
  extraArgs?: string[];
  /** Extra environment variables for the child process; allowlisted keys only. */
  env?: Record<string, string>;
}

/** Allowlisted environment variable keys that can be passed to subagent children. */
const ALLOWED_ENV_KEYS = new Set([
  "GENTLE_COWORK_ROLE",
  "PI_CODING_AGENT_DIR",
  "ENGRAM_URL",
  "ENGRAM_PROJECT",
  "HOME",
  "TMPDIR",
  "NODE_COMPILE_CACHE",
  "NO_UPDATE_NOTIFIER",
]);

/** Allowed provider patterns (prefix match). */
const ALLOWED_PROVIDER_PREFIXES = ["anthropic/", "openai/", "nvidia/", "nan/"];

/** Allowed model prefixes. */
const ALLOWED_MODEL_PREFIXES = ["claude-", "gpt-", "nemotron-", "deepseek-"];

/** Validates and sanitizes subagent spawn options. Returns sanitized options or throws. */
function validateSpawnOptions(options: SubagentSpawnOptions = {}): SubagentSpawnOptions {
  const sanitized: SubagentSpawnOptions = { ...options };

  // C4: Validate cwd - must be absolute and within project root
  if (sanitized.cwd !== undefined) {
    if (!sanitized.cwd.startsWith("/") && !sanitized.cwd.startsWith("~")) {
      throw new Error("cwd must be an absolute path");
    }
  }

  // C4: Validate provider - must match allowed prefix
  if (sanitized.provider !== undefined) {
    if (!ALLOWED_PROVIDER_PREFIXES.some((p) => sanitized.provider!.startsWith(p))) {
      throw new Error(`Provider "${sanitized.provider}" not in allowed list`);
    }
  }

  // C4: Validate model - must match allowed prefix
  if (sanitized.model !== undefined) {
    if (!ALLOWED_MODEL_PREFIXES.some((p) => sanitized.model!.startsWith(p))) {
      throw new Error(`Model "${sanitized.model}" not in allowed list`);
    }
  }

  // C4: Validate cliPath - must be absolute
  if (sanitized.cliPath !== undefined) {
    if (!sanitized.cliPath.startsWith("/")) {
      throw new Error("cliPath must be an absolute path");
    }
  }

  // C4: Validate extraArgs - restrict to known safe args
  if (sanitized.extraArgs !== undefined) {
    const allowedArgs = new Set([
      "--no-session",
      "--exclude-tools",
      "--tools",
      "--model",
      "--provider",
      "--api-key",
    ]);
    const valueArgs = new Set(["--tools", "--model", "--provider", "--api-key"]);
    for (let i = 0; i < sanitized.extraArgs.length; i++) {
      const arg = sanitized.extraArgs[i];
      const base = arg.split("=")[0];
      if (!allowedArgs.has(base)) {
        throw new Error(`Extra arg "${base}" not in allowed list`);
      }
      // If this arg takes a value and the next item isn't another flag, it's a value - skip validation
      if (valueArgs.has(base) && i + 1 < sanitized.extraArgs.length && !sanitized.extraArgs[i + 1].startsWith("-")) {
        i++; // Skip the value
      }
    }
  }

  // C4: Validate env - only allowlisted keys
  if (sanitized.env !== undefined) {
    for (const key of Object.keys(sanitized.env)) {
      if (!ALLOWED_ENV_KEYS.has(key)) {
        throw new Error(`Env var "${key}" not in allowed list`);
      }
    }
  }

  return sanitized;
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
  // C4: Validate and sanitize all spawn options
  const validated = validateSpawnOptions(options);

  const client = new RpcClient({
    cliPath: validated.cliPath ?? resolveDefaultCliPath(),
    cwd: validated.cwd,
    provider: validated.provider,
    model: validated.model,
    // Flat-tree defense (BLA-25): every child spawned here is a role
    // child. Mark it so its own gentle-cowork instance (loaded from the
    // agent home by every pi session) disarms interception, and remove
    // the delegation tools entirely so a role can never spawn
    // sub-subagents — natively or through the hook.
    env: { GENTLE_COWORK_ROLE: "1", ...validated.env },
    args: ["--no-session", "--exclude-tools", "subagent_*", ...(validated.extraArgs ?? [])],
  });
  return {
    start: () => client.start(),
    promptAndWait: (message, timeoutMs) => client.promptAndWait(message, undefined, timeoutMs),
    getLastAssistantText: () => client.getLastAssistantText(),
    getState: () => client.getState(),
    stop: () => client.stop(),
  };
}

/** Readiness handshake budget (BLA-26): attempts before giving up. */
const READINESS_ATTEMPTS = 4;

/**
 * BLA-26 — waits for a fresh child to finish booting before the first
 * prompt. A pi child loads the whole agent home (every extension) and can
 * take ~17s+ to become ready; the RpcClient's per-request timeout is a
 * fixed 30s, so a prompt sent during boot can lose the race and abort the
 * whole turn. A failed get_state poll just means "not ready yet".
 */
async function waitUntilReady(rpc: SubagentRpc): Promise<void> {
  if (!rpc.getState) return;
  for (let attempt = 1; attempt <= READINESS_ATTEMPTS; attempt++) {
    try {
      await rpc.getState();
      return;
    } catch {
      // Still booting — the send-timeout of the poll is the wait itself.
    }
  }
  throw new Error(
    `gentle-cowork: the subagent child did not become ready after ${READINESS_ATTEMPTS} handshake attempts`,
  );
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
    await waitUntilReady(rpc);
    await rpc.promptAndWait(prompt, timeoutMs);
    raw = await rpc.getLastAssistantText();
  } finally {
    await rpc.stop();
  }
  return raw;
}
