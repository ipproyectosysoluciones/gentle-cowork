import { beforeEach, describe, expect, it, vi } from "vitest";
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

interface ApiMock {
  api: ExtensionAPI;
  registerCommand: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  commands: Map<string, CommandHandler>;
  handlers: Map<string, ToolCallHandler>;
}

/** Structural mock of the ExtensionAPI surface this extension uses. */
function createApiMock(): ApiMock {
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
  const api = { registerCommand, on } as unknown as ExtensionAPI;
  return { api, registerCommand, on, commands, handlers };
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

describe("gentle-cowork extension", () => {
  let mock: ApiMock;

  beforeEach(() => {
    mock = createApiMock();
    gentleCoworkExtension(mock.api);
  });

  it("registers /cowork and /cowork-contract with the positional ExtensionAPI signature", () => {
    expect(mock.registerCommand).toHaveBeenCalledWith("cowork", expect.objectContaining({ description: expect.any(String) }));
    expect(mock.registerCommand).toHaveBeenCalledWith("cowork-contract", expect.objectContaining({ description: expect.any(String) }));
  });

  it("subscribes to the tool_call event", () => {
    expect(mock.on).toHaveBeenCalledWith("tool_call", expect.any(Function));
  });

  it("notifies orchestration status through ctx.ui, not a return value", async () => {
    const { ctx, notify } = createCtxMock();
    await mock.commands.get("cowork")!("", ctx);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("[gentle-cowork]"), "info");
  });

  it("builds a TaskContract from a delegation tool call, reading fields from event.input", async () => {
    const { ctx } = createCtxMock();
    mock.handlers.get("tool_call")!(
      customToolCall("subagent_run", {
        objective: "Verify the widget module",
        scope: ["src/widget/"],
        criteria: ["all widget tests pass"],
        specRef: "odd/tasks/widget.md",
      }),
      ctx,
    );

    const { ctx: contractCtx, notify } = createCtxMock();
    await mock.commands.get("cowork-contract")!("", contractCtx);
    expect(notify).toHaveBeenCalledTimes(1);
    const contract = JSON.parse(String(notify.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(contract).toMatchObject({
      id: "gc-1",
      objective: "Verify the widget module",
      role: "implementer",
      scope: ["src/widget/"],
      acceptanceCriteria: ["all widget tests pass"],
      specRef: "odd/tasks/widget.md",
      status: "pending",
    });
  });

  it("ignores builtin tool calls (no contract created)", async () => {
    const { ctx } = createCtxMock();
    mock.handlers.get("tool_call")!(customToolCall("read", { path: "src/widget.ts" }), ctx);

    const { ctx: contractCtx, notify } = createCtxMock();
    await mock.commands.get("cowork-contract")!("", contractCtx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("No contracts"), "info");
  });
});
