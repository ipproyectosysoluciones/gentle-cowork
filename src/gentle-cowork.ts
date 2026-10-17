/**
 * gentle-cowork — orchestration extension for Pi / gentle-shell.
 *
 * A delegation routing layer that respects ODD: delegate by named reason,
 * never by size. Passes the spec by reference, never paraphrased.
 * The intelligence stays agent-side — this extension only routes and records.
 *
 * Phase 0 scope: registers the /cowork status commands and watches
 * tool_call for delegation triggers, building lightweight TaskContracts.
 * Phase 1 scope: /cowork-verify spawns a cowork-verifier subagent
 * (pi --mode rpc) with a test prompt, parses its structured verdict,
 * and logs it to the launcher log (stderr).
 * Phase 2 scope: /cowork-chain runs the full planner → implementer →
 * verifier cycle per step, retrying after CHANGES verdicts (max 3).
 */

import type {
  CustomToolCallEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";

import type { TaskContract } from "./types.ts";
import { createRpcSubagent, type SubagentRpc, type SubagentSpawnOptions } from "./subagent.ts";
import { PHASE1_TEST_REQUIREMENTS, buildVerifyPrompt, runVerifier } from "./verifier.ts";
import { PHASE2_TEST_OBJECTIVE, runChain, type ChainDeps } from "./roles.ts";

/** The exact names for this extension's commands. */
const STATUS_COMMAND = "cowork";
const CONTRACT_COMMAND = "cowork-contract";
const VERIFY_COMMAND = "cowork-verify";
const CHAIN_COMMAND = "cowork-chain";

/** ODD spec document this feature work is tracked against. */
const SPEC_REF = "odd/tasks/gentle-cowork-extension.md";

/** Overall timeout for one verifier spawn, in milliseconds. */
const VERIFY_TIMEOUT_MS = 120_000;

/**
 * Overall timeout for one chain role turn, in milliseconds. Measured real
 * cowork-implementer turn: ~339s (full spec read + scoped write + artifact
 * JSON) — probe 2026-10-16; keep a comfortable margin above it.
 */
const CHAIN_TIMEOUT_MS = 600_000;

/** Maximum implementer attempts per step after CHANGES verdicts (ROADMAP). */
const MAX_CHAIN_RETRIES = 3;

/** Delegation tool name patterns the tool_call hook watches for. */
const DELEGATION_PATTERNS = ["delegate", "subagent", "agent"];

/**
 * Builtin Pi tools that can never be delegation calls.
 * Every delegation-shaped tool (subagent_run, delegate_task, …) is a
 * custom tool, whose input is a free-form Record.
 */
const BUILTIN_TOOLS: ReadonlySet<string> = new Set([
  "bash",
  "powershell",
  "read",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
]);

/** Prefix for every user-facing gentle-cowork notification. */
const PREFIX = "[gentle-cowork]";

/** Detects whether a tool name matches a delegation trigger pattern. */
function isDelegationTrigger(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return DELEGATION_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Narrows a tool call to a custom (non-builtin) tool call — the only kind
 * that can carry a delegation. Builtin tool names never match the
 * delegation patterns above, so any trigger match is a custom tool.
 */
function isCustomToolCall(event: ToolCallEvent): event is CustomToolCallEvent {
  return !BUILTIN_TOOLS.has(event.toolName);
}

/** Reads a non-empty string field from a custom tool input, with fallback. */
function readStringField(input: Record<string, unknown>, key: string, fallback: string): string {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** Reads a string-array field from a custom tool input; drops non-strings. */
function readStringArrayField(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** Builds a pending TaskContract from a delegation tool call input. */
function buildContract(
  id: string,
  objective: string,
  role: TaskContract["role"],
  scope: string[],
  criteria: string[],
  specRef: string,
): TaskContract {
  return {
    id,
    objective,
    role,
    scope,
    acceptanceCriteria: criteria,
    specRef,
    artifacts: [],
    status: "pending",
  };
}

/** Notifies a message through ctx.ui with an optional level (default info). */
function notify(
  ctx: ExtensionCommandContext,
  message: string,
  type?: "info" | "warning" | "error",
): void {
  ctx.ui.notify(message, type ?? "info");
}

/** Extension dependencies; every transport is injectable for tests. */
export interface CoworkDeps {
  connectVerifier?: (options: SubagentSpawnOptions) => SubagentRpc;
  connectSubagent?: (options: SubagentSpawnOptions) => SubagentRpc;
}

export default function gentleCoworkExtension(pi: ExtensionAPI, deps: CoworkDeps = {}): void {
  const connectVerifier = deps.connectVerifier ?? createRpcSubagent;
  const connectSubagent = deps.connectSubagent ?? createRpcSubagent;

  let contractCounter = 0;
  let verifyCounter = 0;
  let chainCounter = 0;
  let lastContract: TaskContract | undefined;

  pi.registerCommand(STATUS_COMMAND, {
    description: "Show gentle-cowork orchestration status",
    handler: async (_args: string, ctx) => {
      if (lastContract) {
        notify(
          ctx,
          `${PREFIX} Last contract: ${lastContract.id} (${lastContract.role}, ${lastContract.status})`,
        );
      } else {
        notify(ctx, `${PREFIX} Ready. No active contracts. Delegation triggers are being watched.`);
      }
    },
  });

  pi.registerCommand(CONTRACT_COMMAND, {
    description: "Show the last gentle-cowork TaskContract",
    handler: async (_args: string, ctx) => {
      if (!lastContract) {
        notify(ctx, `${PREFIX} No contracts issued yet.`);
        return;
      }
      notify(ctx, JSON.stringify(lastContract, null, 2));
    },
  });

  pi.registerCommand(VERIFY_COMMAND, {
    description:
      "Phase 1: spawn a cowork-verifier subagent (pi --mode rpc) with a test prompt and log its verdict",
    handler: async (_args: string, ctx) => {
      const contractId = `vc-${++verifyCounter}`;
      notify(
        ctx,
        `${PREFIX} Spawning cowork-verifier via pi --mode rpc (Phase 1 test, ${PHASE1_TEST_REQUIREMENTS.length} requirements)...`,
      );
      try {
        const prompt = buildVerifyPrompt(contractId, SPEC_REF, PHASE1_TEST_REQUIREMENTS);
        const rpc = connectVerifier({
          cwd: ctx.cwd,
          provider: ctx.model?.provider,
          model: ctx.model?.id,
        });
        const verdict = await runVerifier({ prompt, contractId, rpc, timeoutMs: VERIFY_TIMEOUT_MS });

        // Log the verdict to the launcher log (stderr) per ROADMAP Phase 1.
        console.error(`[gentle-cowork] cowork-verifier verdict for ${contractId}: ${verdict.outcome}`);
        console.error(JSON.stringify(verdict, null, 2));

        // The verification task itself completed; the verdict is its artifact.
        lastContract = {
          ...buildContract(
            contractId,
            "Phase 1 verification test",
            "verifier",
            [],
            ["verdict received"],
            SPEC_REF,
          ),
          artifacts: [JSON.stringify(verdict)],
          status: "completed",
        };

        const summary = verdict.requirements.map((r) => `${r.id}:${r.verdict}`).join(", ");
        notify(ctx, `${PREFIX} Verifier verdict: ${verdict.outcome} — ${summary}`);
        notify(ctx, verdict.report);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[gentle-cowork] cowork-verifier failed for ${contractId}: ${message}`);
        notify(ctx, `${PREFIX} Verification failed: ${message}`, "error");
      }
    },
  });

  pi.registerCommand(CHAIN_COMMAND, {
    description: "Phase 2: run the full planner → implementer → verifier chain with a test objective",
    handler: async (_args: string, ctx) => {
      const contractId = `ch-${++chainCounter}`;
      notify(
        ctx,
        `${PREFIX} Running Phase 2 chain: planner → implementer → verifier. Objective: ${PHASE2_TEST_OBJECTIVE}`,
      );
      try {
        const chainDeps: ChainDeps = {
          connect: connectSubagent,
          spawnOptions: {
            cwd: ctx.cwd,
            provider: ctx.model?.provider,
            model: ctx.model?.id,
          },
          timeoutMs: CHAIN_TIMEOUT_MS,
          maxRetries: MAX_CHAIN_RETRIES,
        };
        const result = await runChain(PHASE2_TEST_OBJECTIVE, SPEC_REF, chainDeps, (line) => {
          notify(ctx, `${PREFIX} ${line}`);
          // Progress also goes to the launcher log so headless runs are diagnosable.
          console.error(`[gentle-cowork] chain progress: ${line}`);
        });

        // Log the chain result to the launcher log (stderr).
        console.error(`[gentle-cowork] chain result for ${contractId}: ${result.status}`);
        console.error(JSON.stringify(result, null, 2));

        const completed = result.steps.filter((s) => s.status === "completed").length;
        lastContract = {
          ...buildContract(
            contractId,
            PHASE2_TEST_OBJECTIVE,
            "planner",
            result.plan.flatMap((step) => step.scope),
            [`all steps completed`],
            SPEC_REF,
          ),
          artifacts: [JSON.stringify(result)],
          status: result.status === "completed" ? "completed" : "failed",
        };

        if (result.status === "completed") {
          notify(ctx, `${PREFIX} Chain completed: ${completed}/${result.steps.length} steps`);
        } else {
          notify(
            ctx,
            `${PREFIX} Chain failed: ${completed}/${result.steps.length} steps — see the launcher log for the last CHANGES verdict`,
            "error",
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[gentle-cowork] chain failed for ${contractId}: ${message}`);
        notify(ctx, `${PREFIX} Chain failed: ${message}`, "error");
      }
    },
  });

  /** Runs the role chain for an intercepted delegation and reports back. */
  async function runDelegatedChain(
    pi: ExtensionAPI,
    contractId: string,
    objective: string,
    specRef: string,
    connect: (options: SubagentSpawnOptions) => SubagentRpc,
    spawnOptions: SubagentSpawnOptions,
  ): Promise<void> {
    try {
      const result = await runChain(
        objective,
        specRef,
        { connect, spawnOptions, timeoutMs: CHAIN_TIMEOUT_MS, maxRetries: MAX_CHAIN_RETRIES },
        (line) => {
          console.error(`[gentle-cowork] chain progress (${contractId}): ${line}`);
        },
      );

      // Log the chain result to the launcher log (stderr).
      console.error(`[gentle-cowork] chain result for ${contractId}: ${result.status}`);
      console.error(JSON.stringify(result, null, 2));

      const completed = result.steps.filter((s) => s.status === "completed").length;
      pi.sendMessage(
        {
          customType: "gentle-cowork-chain-result",
          content: JSON.stringify({
            contractId,
            status: result.status,
            steps: result.steps.map((s) => ({ step: s.step, attempts: s.attempts, status: s.status })),
          }),
          display: true,
        },
        { triggerTurn: true },
      );

      const contract = lastContract;
      if (contract && contract.id === contractId) {
        lastContract = {
          ...contract,
          status: result.status === "completed" ? "completed" : "failed",
          artifacts: [JSON.stringify(result)],
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[gentle-cowork] chain failed for ${contractId}: ${message}`);
      pi.sendMessage(
        {
          customType: "gentle-cowork-chain-result",
          content: JSON.stringify({ contractId, status: "failed", error: message }),
          display: true,
        },
        { triggerTurn: true },
      );
      const contract = lastContract;
      if (contract && contract.id === contractId) {
        lastContract = { ...contract, status: "failed" };
      }
    }
  }

  pi.on("tool_call", async (event, ctx) => {
    // Phase 3 — invisible delegation. ODD already decided this delegation
    // has a valid reason; gentle-cowork applies role orchestration INSTEAD
    // of the native delegation and reports the chain result back to the
    // main agent. Without a named reason, native delegation proceeds
    // untouched (do NOT intercept).
    if (!isDelegationTrigger(event.toolName) || !isCustomToolCall(event)) return;

    const input = event.input;
    const namedReason = readStringField(input, "reason", "");
    if (namedReason === "") {
      // No named reason: do NOT intercept (ROADMAP Phase 3).
      return;
    }

    const objective = readStringField(input, "objective", "Delegated task");
    const scope = readStringArrayField(input, "scope");
    const criteria = readStringArrayField(input, "criteria");
    const specRef = readStringField(input, "specRef", SPEC_REF);

    contractCounter += 1;
    const contractId = `gc-${contractCounter}`;
    lastContract = {
      ...buildContract(
        contractId,
        objective,
        "planner",
        scope,
        criteria.length > 0 ? criteria : [`named reason: ${namedReason}`],
        specRef,
      ),
      status: "in_progress",
    };

    // Capture plain data from the context now: the chain outlives this
    // handler, and a live context may be invalidated by later events.
    const spawnOptions: SubagentSpawnOptions = {
      cwd: ctx.cwd,
      provider: ctx.model?.provider,
      model: ctx.model?.id,
    };

    void runDelegatedChain(pi, contractId, objective, specRef, connectSubagent, spawnOptions);

    return {
      block: true,
      reason:
        `gentle-cowork: role orchestration applied for ${contractId} ` +
        `(named reason: "${namedReason}"); native delegation skipped — ` +
        `the chain result will arrive as a session message.`,
    };
  });
}
