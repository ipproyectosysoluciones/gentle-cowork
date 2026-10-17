import { describe, expect, it, vi } from "vitest";
import {
  PHASE1_TEST_REQUIREMENTS,
  VerifierProtocolError,
  buildVerifyPrompt,
  extractJsonObject,
  parseVerdict,
  runVerifier,
} from "./verifier.ts";

/** A fake VerifierRpc with captured calls, mirroring the injected transport surface. */
function createRpcFake(response: string | null, options: { failOnPrompt?: Error } = {}) {
  const calls = { start: 0, prompts: [] as string[], stop: 0 };
  const rpc = {
    start: vi.fn(async () => {
      calls.start += 1;
    }),
    promptAndWait: vi.fn(async (message: string) => {
      calls.prompts.push(message);
      if (options.failOnPrompt) throw options.failOnPrompt;
      return [];
    }),
    getLastAssistantText: vi.fn(async () => response),
    stop: vi.fn(async () => {
      calls.stop += 1;
    }),
  };
  return { rpc, calls };
}

const VALID_VERDICT_JSON = JSON.stringify({
  contractId: "vc-1",
  requirements: [
    { id: "S1", verdict: "pass", evidence: "src/types.ts declares specRef: string" },
    { id: "S2", verdict: "fail", evidence: "CoworkRole has an extra role" },
  ],
  outcome: "CHANGES",
  report: "S2 failed.",
});

describe("extractJsonObject", () => {
  it("extracts a plain JSON object", () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it("extracts JSON wrapped in markdown fences", () => {
    const text = '```json\n{"a":1}\n```';
    expect(extractJsonObject(text)).toBe('{"a":1}');
  });

  it("extracts the first balanced object embedded in prose", () => {
    const text = 'Here is my verdict:\n{"a":{"b":2}}\nEnd of report.';
    expect(extractJsonObject(text)).toBe('{"a":{"b":2}}');
  });

  it("handles braces inside JSON strings", () => {
    const text = '{"evidence":"found } in string"}';
    expect(extractJsonObject(text)).toBe('{"evidence":"found } in string"}');
  });

  it("returns null when there is no JSON object", () => {
    expect(extractJsonObject("no json here")).toBeNull();
  });
});

describe("parseVerdict", () => {
  it("parses a valid APPROVE verdict", () => {
    const verdict = parseVerdict("vc-1", JSON.stringify({
      contractId: "vc-1",
      requirements: [{ id: "S1", verdict: "pass", evidence: "ok" }],
      outcome: "APPROVE",
      report: "All good.",
    }));
    expect(verdict.outcome).toBe("APPROVE");
    expect(verdict.requirements).toHaveLength(1);
  });

  it("parses a valid verdict embedded in fences and prose", () => {
    const raw = `Sure, here it is:\n\`\`\`json\n${VALID_VERDICT_JSON}\n\`\`\`\nDone.`;
    const verdict = parseVerdict("vc-1", raw);
    expect(verdict.outcome).toBe("CHANGES");
    expect(verdict.requirements[1]).toMatchObject({ id: "S2", verdict: "fail" });
  });

  it("rejects an invalid outcome value", () => {
    const raw = JSON.stringify({ contractId: "vc-1", requirements: [], outcome: "MAYBE", report: "" });
    expect(() => parseVerdict("vc-1", raw)).toThrow(VerifierProtocolError);
  });

  it("rejects a requirement with an invalid verdict", () => {
    const raw = JSON.stringify({
      contractId: "vc-1",
      requirements: [{ id: "S1", verdict: "bogus", evidence: "x" }],
      outcome: "APPROVE",
      report: "",
    });
    expect(() => parseVerdict("vc-1", raw)).toThrow(VerifierProtocolError);
  });

  it("rejects a mismatched contractId", () => {
    expect(() => parseVerdict("vc-expected", VALID_VERDICT_JSON)).toThrow(/contractId/);
  });

  it("throws with the raw response when no JSON is present", () => {
    const raw = "I could not verify anything.";
    try {
      parseVerdict("vc-1", raw);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(VerifierProtocolError);
      expect((error as VerifierProtocolError).rawResponse).toBe(raw);
    }
  });
});

describe("runVerifier", () => {
  it("runs prompt → response → verdict and always stops the client", async () => {
    const { rpc, calls } = createRpcFake(VALID_VERDICT_JSON);
    const verdict = await runVerifier({ prompt: "verify please", contractId: "vc-1", rpc });
    expect(verdict.outcome).toBe("CHANGES");
    expect(calls.start).toBe(1);
    expect(calls.prompts).toEqual(["verify please"]);
    expect(calls.stop).toBe(1);
  });

  it("passes the timeout to promptAndWait when provided", async () => {
    const { rpc } = createRpcFake(VALID_VERDICT_JSON);
    await runVerifier({ prompt: "p", contractId: "vc-1", rpc, timeoutMs: 5000 });
    expect(rpc.promptAndWait).toHaveBeenCalledWith("p", 5000);
  });

  it("throws VerifierProtocolError when the assistant returns null text, stopping the client", async () => {
    const { rpc, calls } = createRpcFake(null);
    await expect(runVerifier({ prompt: "p", contractId: "vc-1", rpc })).rejects.toThrow(VerifierProtocolError);
    expect(calls.stop).toBe(1);
  });

  it("throws VerifierProtocolError on a non-JSON response, stopping the client", async () => {
    const { rpc, calls } = createRpcFake("plain prose, no json");
    await expect(runVerifier({ prompt: "p", contractId: "vc-1", rpc })).rejects.toThrow(VerifierProtocolError);
    expect(calls.stop).toBe(1);
  });

  it("propagates transport failures while still stopping the client", async () => {
    const { rpc, calls } = createRpcFake(VALID_VERDICT_JSON, { failOnPrompt: new Error("spawn failed") });
    await expect(runVerifier({ prompt: "p", contractId: "vc-1", rpc })).rejects.toThrow("spawn failed");
    expect(calls.stop).toBe(1);
  });
});

describe("buildVerifyPrompt", () => {
  it("embeds the contract id, spec reference, and every requirement", () => {
    const prompt = buildVerifyPrompt("vc-1", "odd/tasks/widget.md", [
      { id: "S1", text: "First requirement." },
      { id: "S2", text: "Second requirement." },
    ]);
    expect(prompt).toContain("cowork-verifier");
    expect(prompt).toContain("vc-1");
    expect(prompt).toContain("odd/tasks/widget.md");
    expect(prompt).toContain("S1: First requirement.");
    expect(prompt).toContain("S2: Second requirement.");
    expect(prompt).toContain('"APPROVE"');
    expect(prompt).toContain('"CHANGES"');
  });

  it("Phase 1 test requirements target the repository spec types", () => {
    expect(PHASE1_TEST_REQUIREMENTS.length).toBeGreaterThan(0);
    for (const requirement of PHASE1_TEST_REQUIREMENTS) {
      expect(requirement.id).toMatch(/^S\d+$/);
      expect(requirement.text.length).toBeGreaterThan(0);
    }
    expect(PHASE1_TEST_REQUIREMENTS.some((r) => r.text.includes("src/types.ts"))).toBe(true);
  });
});
