/**
 * Transport tests — the spawn contract of gentle-cowork role children.
 *
 * BLA-25 flat-tree defense: every child this extension spawns is a role
 * child. The spawn must mark it (GENTLE_COWORK_ROLE) so the child's own
 * gentle-cowork instance — loaded from the agent home — disarms its
 * interception hook, and must disable the child's delegation tools
 * entirely so a role can never spawn sub-subagents: not natively, not
 * through the hook.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  RpcClient: vi.fn(),
}));

import { RpcClient } from "@earendil-works/pi-coding-agent";
import { createRpcSubagent, runSubagentTurn } from "./subagent.ts";

describe("gentle-cowork role-child spawn contract", () => {
  it("marks the child as a role child (GENTLE_COWORK_ROLE) and disables its delegation tools", () => {
    vi.mocked(RpcClient).mockClear();

    createRpcSubagent({ cwd: "/tmp/scenario", provider: "nvidia", model: "z-ai/glm-5.3" });

    expect(RpcClient).toHaveBeenCalledTimes(1);
    expect(RpcClient).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({ GENTLE_COWORK_ROLE: "1" }),
        args: expect.arrayContaining(["--no-session", "--exclude-tools", "subagent_*"]),
      }),
    );
  });

  it("keeps caller-provided extra args after the flat-tree defense args", () => {
    vi.mocked(RpcClient).mockClear();

    createRpcSubagent({ extraArgs: ["--flag"] });

    const options = vi.mocked(RpcClient).mock.calls[0]?.[0] as { args: string[] };
    expect(options.args).toEqual(["--no-session", "--exclude-tools", "subagent_*", "--flag"]);
  });
});

describe("gentle-cowork subagent turn readiness handshake (BLA-26)", () => {
  it("waits for a slow-booting child (retries the handshake) before prompting", async () => {
    let remainingFailures = 1; // first get_state times out like a 30s send-timeout, second acknowledges
    const rpc = {
      start: vi.fn(async () => {}),
      getState: vi.fn(async () => {
        if (remainingFailures-- > 0) {
          throw new Error("Timeout waiting for response to get_state. Stderr: booting");
        }
        return {};
      }),
      promptAndWait: vi.fn(async () => []),
      getLastAssistantText: vi.fn(async () => "[]"),
      stop: vi.fn(async () => {}),
    };

    const text = await runSubagentTurn("plan this", rpc as never);

    expect(rpc.getState).toHaveBeenCalledTimes(2);
    expect(rpc.promptAndWait).toHaveBeenCalledTimes(1);
    // The handshake must complete BEFORE the first prompt is sent.
    expect(rpc.getState.mock.invocationCallOrder[0]).toBeLessThan(
      rpc.promptAndWait.mock.invocationCallOrder[0],
    );
    expect(text).toBe("[]");
  });

  it("fails with a readiness error (and stops the client) when the child never acknowledges", async () => {
    const rpc = {
      start: vi.fn(async () => {}),
      getState: vi.fn(async () => {
        throw new Error("Timeout waiting for response to get_state. Stderr: booting");
      }),
      promptAndWait: vi.fn(async () => []),
      getLastAssistantText: vi.fn(async () => null),
      stop: vi.fn(async () => {}),
    };

    await expect(runSubagentTurn("plan this", rpc as never)).rejects.toThrow(/did not become ready/i);
    expect(rpc.stop).toHaveBeenCalled();
    expect(rpc.promptAndWait).not.toHaveBeenCalled();
  });
});
