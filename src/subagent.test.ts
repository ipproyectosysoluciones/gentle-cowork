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
import { createRpcSubagent } from "./subagent.ts";

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
