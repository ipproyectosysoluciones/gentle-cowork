/**
 * Phase 3 tests — invisible delegation via the tool_call hook.
 *
 * A delegation tool call with a NAMED reason is blocked and routed through
 * the planner → implementer → verifier chain; the result is reported back
 * to the main agent via sendMessage. A delegation without a named reason
 * is never intercepted.
 */

import { describe, expect, it, vi } from "vitest";
import type {
  CustomToolCallEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionHandler,
  RegisteredCommand,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

import gentleCoworkExtension from "./gentle-cowork.ts";

type CommandHandler = RegisteredCommand["handler"];
type ToolCallHandler = ExtensionHandler<ToolCallEvent, ToolCallEventResult>;

/** Structural mock of the ExtensionAPI surface this extension uses. */
function createApiMock() {
  const commands = new Map<string, CommandHandler>();
  const handlers = new Map<string, ToolCallHandler>();
  const registerCommand = vi.fn((name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
    commands.set(name, options.handler);
  });
  const on = vi.fn((event: string, handler: ToolCallHandler) => {
    handlers.set(event, handler);
    return () => {
      handlers.delete(event);
    };
  });
  const sendMessage = vi.fn();
  const api = { registerCommand, on, sendMessage } as unknown as ExtensionAPI;
  return { api, registerCommand, on, sendMessage, commands, handlers };
}

/** Command-context mock that captures ui notifications. */
function createCtxMock(): { ctx: ExtensionCommandContext; notify: ReturnType<typeof vi.fn> } {
  const notify = vi.fn();
  const ctx = { ui: { notify } } as unknown as ExtensionCommandContext;
  return { ctx, notify };
}

/** A custom (non-builtin) tool call — the only kind that can carry a delegation. */
function customToolCall(toolName: string, input: Record<string, unknown>): CustomToolCallEvent {
  return { type: "tool_call", toolCallId: `tc-${toolName}`, toolName, input };
}

/** Dispatching fake: role-based responses per subagent turn. */
function createChainConnectFake() {
  const planJson = JSON.stringify([
    {
      step: 1,
      objective: "Create the demo file.",
      scope: ["docs/phase2-demo.md"],
      acceptanceCriteria: ["The file exists with exactly one line."],
    },
  ]);
  const artifactJson = JSON.stringify({
    filesModified: ["docs/phase2-demo.md"],
    changesSummary: "Created the demo file.",
    stepsCompleted: ["created docs/phase2-demo.md"],
    notes: "none",
  });
  return (_options: unknown) => {
    let lastPrompt = "";
    return {
      start: vi.fn(async () => {}),
      promptAndWait: vi.fn(async (message: string) => {
        lastPrompt = message;
        return [];
      }),
      getLastAssistantText: vi.fn(async () => {
        const contractId = lastPrompt.match(/cc-\d+/)?.[0] ?? "cc-1";
        if (lastPrompt.includes("cowork-planner")) return planJson;
        if (lastPrompt.includes("cowork-implementer")) return artifactJson;
        if (lastPrompt.includes("cowork-verifier")) {
          return JSON.stringify({
            contractId,
            requirements: [{ id: "C1", verdict: "pass", evidence: "checked" }],
            outcome: "APPROVE",
            report: "Step verdict.",
          });
        }
        return "unknown role prompt";
      }),
      stop: vi.fn(async () => {}),
    };
  };
}

/** Polls until the condition holds or the budget runs out. */
async function waitUntil(condition: () => boolean, budgetMs = 500): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("gentle-cowork invisible delegation (Phase 3)", () => {
  it("blocks a delegation with a named reason and records the contract from event.input", async () => {
    const local = createApiMock();
    gentleCoworkExtension(local.api, { connectSubagent: createChainConnectFake() });
    const { ctx } = createCtxMock();
    const handler = local.handlers.get("tool_call")!;

    const result = await handler(
      customToolCall("subagent_run", {
        objective: "Verify the widget module",
        scope: ["src/widget/"],
        criteria: ["all widget tests pass"],
        specRef: "odd/tasks/widget.md",
        reason: "independent verification",
      }),
      ctx,
    );

    expect(result).toMatchObject({ block: true, reason: expect.stringContaining("gentle-cowork") });

    const { ctx: contractCtx, notify } = createCtxMock();
    await local.commands.get("cowork-contract")!("", contractCtx);
    const contract = JSON.parse(String(notify.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(contract).toMatchObject({
      id: "gc-1",
      objective: "Verify the widget module",
      role: "planner",
      scope: ["src/widget/"],
      acceptanceCriteria: ["all widget tests pass"],
      specRef: "odd/tasks/widget.md",
      status: "in_progress",
    });
  });

  it("routes a named-reason delegation through the role chain and reports back via sendMessage", async () => {
    const local = createApiMock();
    gentleCoworkExtension(local.api, { connectSubagent: createChainConnectFake() });
    const { ctx } = createCtxMock();
    const handler = local.handlers.get("tool_call")!;

    const result = await handler(
      customToolCall("subagent_run", {
        objective: "Add the demo widget",
        scope: ["src/widget/"],
        criteria: ["widget tests pass"],
        specRef: "odd/tasks/widget.md",
        reason: "independent verification",
      }),
      ctx,
    );

    expect(result).toMatchObject({ block: true });
    await waitUntil(() => local.sendMessage.mock.calls.length > 0);
    expect(local.sendMessage.mock.calls.length).toBeGreaterThan(0);

    const [message, options] = local.sendMessage.mock.calls[0] as [
      { customType: string; content: string; display: boolean },
      { triggerTurn?: boolean } | undefined,
    ];
    expect(message.customType).toBe("gentle-cowork-chain-result");
    expect(options?.triggerTurn).toBe(true);
    const payload = JSON.parse(message.content) as Record<string, unknown>;
    expect(payload).toMatchObject({ contractId: "gc-1", status: "completed" });
  });

  it("reports chain failures back to the main agent", async () => {
    const local = createApiMock();
    const failingConnect = () => ({
      start: vi.fn(async () => {
        throw new Error("spawn failed");
      }),
      promptAndWait: vi.fn(async () => []),
      getLastAssistantText: vi.fn(async () => null),
      stop: vi.fn(async () => {}),
    });
    gentleCoworkExtension(local.api, { connectSubagent: failingConnect });
    const { ctx } = createCtxMock();

    await local.handlers.get("tool_call")!(
      customToolCall("subagent_run", {
        objective: "Add the demo widget",
        scope: ["src/widget/"],
        criteria: [],
        specRef: "odd/tasks/widget.md",
        reason: "real parallelism",
      }),
      ctx,
    );

    await waitUntil(() => local.sendMessage.mock.calls.length > 0);
    const [message] = local.sendMessage.mock.calls[0] as [{ content: string }, unknown];
    const payload = JSON.parse(message.content) as Record<string, unknown>;
    expect(payload).toMatchObject({ contractId: "gc-1", status: "failed", error: "spawn failed" });
  });

  it("lets a delegation without a named reason proceed natively (not intercepted)", async () => {
    const local = createApiMock();
    gentleCoworkExtension(local.api, { connectSubagent: createChainConnectFake() });
    const { ctx } = createCtxMock();

    const result = await local.handlers.get("tool_call")!(
      customToolCall("subagent_run", {
        objective: "No reason given",
        scope: ["src/"],
        criteria: [],
        specRef: "odd/tasks/widget.md",
      }),
      ctx,
    );

    expect(result).toBeUndefined();
    await new Promise((r) => setTimeout(r, 50));
    expect(local.sendMessage).not.toHaveBeenCalled();

    const { ctx: contractCtx, notify } = createCtxMock();
    await local.commands.get("cowork-contract")!("", contractCtx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("No contracts"), "info");
  });
});
