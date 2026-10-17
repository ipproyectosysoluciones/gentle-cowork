/**
 * gentle-cowork — orchestration extension for Pi / gentle-shell.
 *
 * A delegation routing layer that respects ODD: delegate by named reason,
 * never by size. Passes the spec by reference, never paraphrased.
 * The intelligence stays agent-side — this extension only routes and records.
 *
 * Phase 0 scope (this file): registers the /cowork status commands and
 * watches tool_call for delegation triggers, building lightweight
 * TaskContracts. Role spawning (planner → implementer → verifier) arrives
 * with the later ROADMAP phases; until then the contracts are read-only
 * orchestration state surfaced through /cowork and /cowork-contract.
 */

import type {
  CustomToolCallEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";

import type { TaskContract } from "./types.ts";

/** The exact names for this extension's commands. */
const STATUS_COMMAND = "cowork";
const CONTRACT_COMMAND = "cowork-contract";

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

/** Notifies a single-line message through ctx.ui (info level). */
function notify(ctx: ExtensionCommandContext, message: string): void {
  ctx.ui.notify(message, "info");
}

export default function gentleCoworkExtension(pi: ExtensionAPI): void {
  let contractCounter = 0;
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

  pi.on("tool_call", (event) => {
    // ODD already decided this delegation has a valid named reason.
    // gentle-cowork records the contract; role orchestration arrives with
    // the later ROADMAP phases.
    if (!isDelegationTrigger(event.toolName) || !isCustomToolCall(event)) return;

    const { input } = event;
    contractCounter += 1;
    lastContract = buildContract(
      `gc-${contractCounter}`,
      readStringField(input, "objective", "Delegated task"),
      "implementer",
      readStringArrayField(input, "scope"),
      readStringArrayField(input, "criteria"),
      readStringField(input, "specRef", "odd/tasks/current.md"),
    );
  });
}
