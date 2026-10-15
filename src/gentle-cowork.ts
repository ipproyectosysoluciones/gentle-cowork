/**
 * gentle-cowork — orchestration extension for Pi / gentle-shell.
 *
 * A delegation routing layer that respects ODD: delegate by named reason,
 * never by size. Passes the spec by reference, never paraphrased.
 * Uses the existing Pi extension mechanism and subagent infrastructure.
 */

import { type TaskContract, type CoworkRole, type VerifyVerdict } from "./types.ts";

/** The exact name for this extension's command. */
const COMMAND = "cowork";

/** Delegation tool name patterns the tool_call hook watches for. */
const DELEGATION_PATTERNS = ["delegate", "subagent", "agent"];

/** Roles this extension manages, mapped to their agent definition files. */
const ROLES: Record<CoworkRole, string> = {
  planner: "agents/cowork-planner.md",
  implementer: "agents/cowork-implementer.md",
  verifier: "agents/cowork-verifier.md",
};

/** Builds a TaskContract from the current delegation context. */
function buildContract(
  id: string,
  objective: string,
  role: CoworkRole,
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

/** Detects whether a tool name matches a delegation trigger pattern. */
function isDelegationTrigger(toolName: string): boolean {
  return DELEGATION_PATTERNS.some((pattern) => toolName.toLowerCase().includes(pattern));
}

export default function gentleCoworkExtension(api: any) {
  let contractCounter = 0;
  let lastContract: TaskContract | undefined;

  // ── /cowork command ────────────────────────────────────────────────────────
  api.registerCommand?.({
    name: COMMAND,
    description: "Show gentle-cowork orchestration status",
    handler: () => {
      if (lastContract) {
        return `[gentle-cowork] Last contract: ${lastContract.id} (${lastContract.role}, ${lastContract.status})`;
      }
      return `[gentle-cowork] Ready. No active contracts. Delegation triggers are being watched.`;
    },
  });

  // ── tool_call hook — detect delegation triggers ───────────────────────────
  api.on?.("tool_call", (event: any) => {
    const toolName = event?.toolName || event?.tool || "";
    if (!isDelegationTrigger(toolName)) return;

    // ODD already decided this delegation has a valid reason.
    // gentle-cowork applies role orchestration on top of it.
    contractCounter++;
    const contract = buildContract(
      `gc-${contractCounter}`,
      event?.objective || "Delegated task",
      "implementer",
      event?.scope || [],
      event?.criteria || [],
      event?.specRef || "odd/tasks/current.md",
    );
    lastContract = contract;
  });

  // ── before_agent_start hook — inject role context into subagents ──────────
  api.on?.("before_agent_start", (event: any) => {
    if (!lastContract) return;
    // Inject the role and spec reference into the subagent's context.
    const roleFile = ROLES[lastContract.role];
    if (roleFile && event?.context) {
      event.context.roleFile = roleFile;
      event.context.specRef = lastContract.specRef;
    }
  });

  // ── /cowork status (console log helper) ───────────────────────────────────
  api.registerCommand?.({
    name: `${COMMAND}-contract`,
    description: "Show the last TaskContract",
    handler: () => {
      if (!lastContract) return "No contracts issued.";
      return JSON.stringify(lastContract, null, 2);
    },
  });
}
