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

/** A fake VerifierRpc used as the injected transport for /cowork-verify tests. */
function createVerifierRpcFake(response: string | null, options: { failOnPrompt?: Error } = {}) {
  return {
    start: vi.fn(async () => {}),
    promptAndWait: vi.fn(async (_message: string) => {
      if (options.failOnPrompt) throw options.failOnPrompt;
      return [];
    }),
    getLastAssistantText: vi.fn(async () => response),
    stop: vi.fn(async () => {}),
  };
}

const VERIFY_VERDICT_JSON = JSON.stringify({
  contractId: "vc-1",
  requirements: [{ id: "S1", verdict: "pass", evidence: "src/types.ts declares specRef" }],
  outcome: "APPROVE",
  report: "All requirements verified.",
});

/** Dispatching fake for /cowork-chain: role-based responses per subagent turn. */
function createChainConnectFake(options: { verifierAlwaysChanges?: boolean } = {}) {
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
          const outcome = options.verifierAlwaysChanges ? "CHANGES" : "APPROVE";
          return JSON.stringify({
            contractId,
            requirements: [{ id: "C1", verdict: outcome === "APPROVE" ? "pass" : "fail", evidence: "checked" }],
            outcome,
            report: "Step verdict.",
          });
        }
        return "unknown role prompt";
      }),
      stop: vi.fn(async () => {}),
    };
  };
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

  it("ignores builtin tool calls (no contract created)", async () => {
    const { ctx } = createCtxMock();
    mock.handlers.get("tool_call")!(customToolCall("read", { path: "src/widget.ts" }), ctx);

    const { ctx: contractCtx, notify } = createCtxMock();
    await mock.commands.get("cowork-contract")!("", contractCtx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("No contracts"), "info");
  });
});

describe("gentle-cowork /cowork-verify (Phase 1)", () => {
  it("registers /cowork-verify with the positional signature", () => {
    const local = createApiMock();
    gentleCoworkExtension(local.api);
    expect(local.registerCommand).toHaveBeenCalledWith("cowork-verify", expect.objectContaining({ description: expect.any(String) }));
  });

  it("runs a verification through the injected transport, logs the verdict, and records the artifact", async () => {
    const rpcFake = createVerifierRpcFake(VERIFY_VERDICT_JSON);
    const local = createApiMock();
    gentleCoworkExtension(local.api, { connectVerifier: () => rpcFake });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { ctx, notify } = createCtxMock();
      await local.commands.get("cowork-verify")!("", ctx);

      expect(notify).toHaveBeenCalledWith(expect.stringContaining("APPROVE"), "info");
      expect(rpcFake.promptAndWait).toHaveBeenCalledWith(expect.stringContaining("cowork-verifier"), 120_000);
      const logged = errorSpy.mock.calls.flat().map(String).join(" ");
      expect(logged).toContain("vc-1");
      expect(logged).toContain("APPROVE");

      const { ctx: contractCtx, notify: contractNotify } = createCtxMock();
      await local.commands.get("cowork-contract")!("", contractCtx);
      const contractText = String(contractNotify.mock.calls[0]?.[0]);
      expect(contractText).toContain("APPROVE");
      expect(contractText).toContain("specRef");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("reports verification failures as error notifications", async () => {
    const rpcFake = createVerifierRpcFake(null, { failOnPrompt: new Error("spawn failed") });
    const local = createApiMock();
    gentleCoworkExtension(local.api, { connectVerifier: () => rpcFake });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { ctx, notify } = createCtxMock();
      await local.commands.get("cowork-verify")!("", ctx);
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("spawn failed"), "error");
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("gentle-cowork /cowork-chain (Phase 2)", () => {
  it("registers /cowork-chain with the positional signature", () => {
    const local = createApiMock();
    gentleCoworkExtension(local.api);
    expect(local.registerCommand).toHaveBeenCalledWith(
      "cowork-chain",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("runs the full chain through injected transports and reports completion", async () => {
    const local = createApiMock();
    gentleCoworkExtension(local.api, { connectSubagent: createChainConnectFake() });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { ctx, notify } = createCtxMock();
      await local.commands.get("cowork-chain")!("", ctx);

      const notified = notify.mock.calls.flat().map(String).join(" ");
      expect(notified).toContain("planner");
      expect(notified).toContain("completed");

      const logged = errorSpy.mock.calls.flat().map(String).join(" ");
      expect(logged).toContain("APPROVE");

      const { ctx: contractCtx, notify: contractNotify } = createCtxMock();
      await local.commands.get("cowork-contract")!("", contractCtx);
      const contractText = String(contractNotify.mock.calls[0]?.[0]);
      expect(contractText).toContain("docs/phase2-demo.md");
      expect(contractText).toContain("completed");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("reports chain failure when a step exhausts its retries", async () => {
    const local = createApiMock();
    gentleCoworkExtension(local.api, { connectSubagent: createChainConnectFake({ verifierAlwaysChanges: true }) });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { ctx, notify } = createCtxMock();
      await local.commands.get("cowork-chain")!("", ctx);
      const notified = notify.mock.calls.flat().map(String).join(" ");
      expect(notified).toContain("failed");
    } finally {
      errorSpy.mockRestore();
    }
  });
});
