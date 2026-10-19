import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CustomToolCallEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionHandler,
  RegisteredCommand,
  SessionStartEvent,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

import gentleCoworkExtension from "./gentle-cowork.ts";
import type { TaskContract } from "./types.ts";

type CommandHandler = RegisteredCommand["handler"];
type ToolCallHandler = ExtensionHandler<ToolCallEvent, ToolCallEventResult>;

interface ApiMock {
  api: ExtensionAPI;
  registerCommand: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  commands: Map<string, CommandHandler>;
  handlers: Map<string, ToolCallHandler>;
}

/** Structural mock of the ExtensionAPI surface this extension uses. */
function createApiMock(): ApiMock {
  const commands = new Map<string, CommandHandler>();
  const handlers = new Map<string, ToolCallHandler>();
  const sendMessage = vi.fn();
  const registerCommand = vi.fn((name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
    commands.set(name, options.handler);
  });
  const on = vi.fn((event: string, handler: ToolCallHandler) => {
    handlers.set(event, handler);
    return () => {
      handlers.delete(event);
    };
  });
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

// ── Phase 4: blackboard state persistence (S5) ─────────────────────────────

describe("gentle-cowork blackboard persistence (Phase 4)", () => {
  type SessionStartHandler = (event: SessionStartEvent, ctx: ExtensionContext) => Promise<void> | void;

  /** A well-formed TaskContract as it appears on the blackboard (new format, for seeding). */
  function persistedContract(overrides: Partial<TaskContract> = {}): TaskContract {
    const status = overrides.status ?? "in_progress";
    const base: TaskContract = {
      id: "gc-7",
      objective: "Interrupted delegation",
      role: "planner",
      scope: ["src/widget/"],
      acceptanceCriteria: ["all widget tests pass"],
      specRef: "odd/tasks/gentle-cowork-extension.md",
      artifacts: [],
      status,
      version: 1,
      history: [{
        status,
        version: 1,
        nodeId: "legacy",
        timestamp: new Date().toISOString(),
      }],
      leaseFence: undefined,
      retryCount: 0,
      ...overrides,
    };
    return base;
  }

  /** Fires the extension's session_start handler as Pi does on session load. */
  async function startSession(mock: ApiMock, cwd: string): Promise<void> {
    expect(mock.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    const handler = mock.handlers.get("session_start") as SessionStartHandler | undefined;
    expect(handler).toBeDefined();
    await handler!({ type: "session_start", reason: "startup" }, { cwd } as unknown as ExtensionContext);
  }

  /** Command-context mock with a real project cwd (the blackboard location). */
  function createCtxMockWithCwd(cwd: string): { ctx: ExtensionCommandContext; notify: ReturnType<typeof vi.fn> } {
    const notify = vi.fn();
    const ctx = { ui: { notify }, cwd } as unknown as ExtensionCommandContext;
    return { ctx, notify };
  }

  /** The blackboard state file path for a project cwd. */
  function boardPath(cwd: string): string {
    return join(cwd, ".gentle-cowork", "blackboard.json");
  }

  /** Reads the persisted contracts straight from the state file on disk. */
  function readBoard(cwd: string): TaskContract[] {
    const raw = JSON.parse(readFileSync(boardPath(cwd), "utf8")) as { version: number; contracts: TaskContract[] };
    expect(raw.version).toBe(2);
    return raw.contracts;
  }

  /** Seeds a state file with raw JSON (the board a dead daemon left behind). */
  function seedBoard(cwd: string, contracts: TaskContract[]): void {
    mkdirSync(dirname(boardPath(cwd)), { recursive: true });
    writeFileSync(boardPath(cwd), JSON.stringify({ version: 1, contracts }), "utf8");
  }

  /** Polls until the condition holds or the budget runs out. */
  async function waitUntil(condition: () => boolean, budgetMs = 2000): Promise<void> {
    const deadline = Date.now() + budgetMs;
    while (!condition() && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  /** Chain fake whose turns park on a real timer, so a mid-flight
   * blackboard read between interception and chain completion is
   * deterministic (microtask draining alone can never finish the chain). */
  function delayedChainConnectFake(delayMs = 20) {
    const base = createChainConnectFake();
    return (options: unknown) => {
      const rpc = base(options);
      const innerPromptAndWait = rpc.promptAndWait;
      return {
        ...rpc,
        promptAndWait: vi.fn(async (message: string) => {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          return innerPromptAndWait(message);
        }),
      };
    };
  }

  it("restores persisted contracts on session_start (a restart loses nothing)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gentle-cowork-p4-"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const seeded = persistedContract();
      seedBoard(tmp, [seeded]);

      const local = createApiMock();
      gentleCoworkExtension(local.api);
      await startSession(local, tmp);

      const { ctx, notify } = createCtxMockWithCwd(tmp);
      await local.commands.get("cowork")!("", ctx);
      const status = String(notify.mock.calls[0]?.[0]);
      expect(status).toContain("gc-7");
      expect(status).toContain("in_progress");

      const { ctx: contractCtx, notify: contractNotify } = createCtxMockWithCwd(tmp);
      await local.commands.get("cowork-contract")!("", contractCtx);
      expect(JSON.parse(String(contractNotify.mock.calls[0]?.[0]))).toEqual(seeded);
    } finally {
      errorSpy.mockRestore();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("continues contract numbering from the persisted board and records the delegation end to end", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gentle-cowork-p4-"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const old = persistedContract({ id: "gc-3", objective: "Old completed work", status: "completed" });
      seedBoard(tmp, [old]);

      const local = createApiMock();
      gentleCoworkExtension(local.api, { connectSubagent: delayedChainConnectFake() });
      await startSession(local, tmp);

      const { ctx } = createCtxMockWithCwd(tmp);
      const result = await local.handlers.get("tool_call")!(
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

      // Mid-flight (chain parked on its first role turn): the interception
      // already persisted the new contract as in_progress, next id gc-4.
      // Note: old is normalized by session_start, so it includes version/history/retryCount
      const normalizedOld = {
        ...old,
        version: 1,
        history: [{ status: "completed", version: 1, nodeId: "legacy", timestamp: expect.any(String) }],
        retryCount: 0,
      };
      expect(readBoard(tmp)).toEqual([
        normalizedOld,
        {
          id: "gc-4",
          objective: "Add the demo widget",
          role: "planner",
          scope: ["src/widget/"],
          acceptanceCriteria: ["widget tests pass"],
          specRef: "odd/tasks/widget.md",
          artifacts: [],
          status: "in_progress",
          version: 1,
          history: [{ status: "pending", version: 1, nodeId: "extension", timestamp: expect.any(String) }],
          retryCount: 0,
        },
      ]);

      await waitUntil(() => local.sendMessage.mock.calls.length > 0);
      const board = readBoard(tmp);
      expect(board).toHaveLength(2);
      expect(board[1]).toMatchObject({ id: "gc-4", status: "completed" });
      expect(board[1]?.artifacts).toHaveLength(1);
    } finally {
      errorSpy.mockRestore();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("persists an intercepted delegation even without a prior session_start (lazy board open)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gentle-cowork-p4-"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const local = createApiMock();
      gentleCoworkExtension(local.api, { connectSubagent: delayedChainConnectFake() });

      const { ctx } = createCtxMockWithCwd(tmp);
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

      expect(readBoard(tmp)).toHaveLength(1);
      expect(readBoard(tmp)[0]).toMatchObject({ id: "gc-1", status: "in_progress" });

      await waitUntil(() => local.sendMessage.mock.calls.length > 0);
      expect(readBoard(tmp)[0]).toMatchObject({ id: "gc-1", status: "completed" });
    } finally {
      errorSpy.mockRestore();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("marks the persisted contract failed when the delegated chain fails", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gentle-cowork-p4-"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failingConnect = () => ({
        start: vi.fn(async () => {
          throw new Error("spawn failed");
        }),
        promptAndWait: vi.fn(async () => []),
        getLastAssistantText: vi.fn(async () => null),
        stop: vi.fn(async () => {}),
      });
      const local = createApiMock();
      gentleCoworkExtension(local.api, { connectSubagent: failingConnect });

      const { ctx } = createCtxMockWithCwd(tmp);
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
      expect(readBoard(tmp)).toHaveLength(1);
      expect(readBoard(tmp)[0]).toMatchObject({ id: "gc-1", status: "failed" });
    } finally {
      errorSpy.mockRestore();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("persists the /cowork-verify verdict contract to the blackboard", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gentle-cowork-p4-"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const rpcFake = createVerifierRpcFake(VERIFY_VERDICT_JSON);
      const local = createApiMock();
      gentleCoworkExtension(local.api, { connectVerifier: () => rpcFake });

      const { ctx } = createCtxMockWithCwd(tmp);
      await local.commands.get("cowork-verify")!("", ctx);

      const persisted = readBoard(tmp);
      expect(persisted).toHaveLength(1);
      expect(persisted[0]).toMatchObject({ id: "vc-1", role: "verifier", status: "completed" });
      const artifact = JSON.parse(String(persisted[0]?.artifacts[0])) as { outcome: string };
      expect(artifact.outcome).toBe("APPROVE");
    } finally {
      errorSpy.mockRestore();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("persists the /cowork-chain contract from chain start (in_progress) to chain result (completed)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gentle-cowork-p4-"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const capturedBoards: Array<{ contracts: Array<Record<string, unknown>> }> = [];
      const base = createChainConnectFake();
      const capturingConnect = (options: unknown) => {
        const rpc = base(options);
        const innerStart = rpc.start;
        let captured = false;
        return {
          ...rpc,
          start: vi.fn(async () => {
            if (!captured) {
              captured = true;
              try {
                capturedBoards.push(
                  JSON.parse(readFileSync(boardPath(tmp), "utf8")) as {
                    contracts: Array<Record<string, unknown>>;
                  },
                );
              } catch {
                // No board on disk yet at chain start — that is itself a defect
                // this test must surface via the assertion below.
              }
            }
            await innerStart();
          }),
        };
      };

      const local = createApiMock();
      gentleCoworkExtension(local.api, { connectSubagent: capturingConnect });
      const { ctx } = createCtxMockWithCwd(tmp);
      await local.commands.get("cowork-chain")!("", ctx);

      // The chain-start persist happened before the first role turn began.
      expect(capturedBoards[0]?.contracts[0]).toMatchObject({ id: "ch-1", status: "in_progress" });
      const persisted = readBoard(tmp);
      expect(persisted).toHaveLength(1);
      expect(persisted[0]).toMatchObject({ id: "ch-1", status: "completed" });
      expect(persisted[0]?.artifacts).toHaveLength(1);
    } finally {
      errorSpy.mockRestore();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
