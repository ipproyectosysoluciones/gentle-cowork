import { describe, expect, it, vi } from "vitest";
import {
  PHASE2_TEST_OBJECTIVE,
  buildImplementPrompt,
  buildPlanPrompt,
  buildStepVerifyPrompt,
  parseArtifact,
  parsePlan,
  runChain,
  runImplementer,
  runPlanner,
  type ChainDeps,
} from "./roles.ts";
import { SubagentProtocolError } from "./subagent.ts";

const PLAN_JSON = JSON.stringify([
  {
    step: 1,
    objective: "Create the demo file.",
    scope: ["docs/phase2-demo.md"],
    acceptanceCriteria: ["The file docs/phase2-demo.md exists with exactly one line."],
  },
]);

const ARTIFACT_JSON = JSON.stringify({
  filesModified: ["docs/phase2-demo.md"],
  changesSummary: "Created the demo file.",
  stepsCompleted: ["created docs/phase2-demo.md"],
  notes: "none",
});

function approveFor(message: string): string {
  const contractId = message.match(/cc-\d+/)?.[0] ?? "cc-1";
  return JSON.stringify({
    contractId,
    requirements: [{ id: "C1", verdict: "pass", evidence: "file verified" }],
    outcome: "APPROVE",
    report: "Step verified.",
  });
}

function changesFor(message: string): string {
  const contractId = message.match(/cc-\d+/)?.[0] ?? "cc-1";
  return JSON.stringify({
    contractId,
    requirements: [{ id: "C1", verdict: "fail", evidence: "file missing" }],
    outcome: "CHANGES",
    report: "Step not satisfied.",
  });
}

/**
 * A dispatching connect: every connect() returns a fresh subagent whose
 * response is selected by the role named in the prompt it received.
 */
function createDispatchingConnect(responses: {
  planner?: string;
  implementer?: string;
  verifier?: (message: string) => string;
}) {
  const calls: string[] = [];
  const connect = (_options: unknown) => {
    let lastPrompt = "";
    return {
      start: vi.fn(async () => {}),
      promptAndWait: vi.fn(async (message: string) => {
        lastPrompt = message;
        calls.push(message);
        return [];
      }),
      getLastAssistantText: vi.fn(async () => {
        if (lastPrompt.includes("cowork-planner")) return responses.planner ?? PLAN_JSON;
        if (lastPrompt.includes("cowork-implementer")) return responses.implementer ?? ARTIFACT_JSON;
        if (lastPrompt.includes("cowork-verifier")) {
          return (responses.verifier ?? approveFor)(lastPrompt);
        }
        return "unknown role prompt";
      }),
      stop: vi.fn(async () => {}),
    };
  };
  return { connect, calls };
}

function createDeps(connect: (options: unknown) => unknown, maxRetries = 3): ChainDeps {
  return {
    connect: connect as ChainDeps["connect"],
    spawnOptions: {},
    maxRetries,
  };
}

describe("buildPlanPrompt", () => {
  it("embeds the objective, spec reference, read-only role, and expected JSON shape", () => {
    const prompt = buildPlanPrompt("Create the demo.", "odd/tasks/demo.md");
    expect(prompt).toContain("cowork-planner");
    expect(prompt).toContain("read-only");
    expect(prompt).toContain("Create the demo.");
    expect(prompt).toContain("odd/tasks/demo.md");
    expect(prompt).toContain('"scope"');
    expect(prompt).toContain('"acceptanceCriteria"');
  });
});

describe("parsePlan", () => {
  it("parses a valid plan and normalizes step numbers sequentially", () => {
    const raw = JSON.stringify([
      { step: 3, objective: "A", scope: ["a.ts"], acceptanceCriteria: ["c1"] },
      { step: 7, objective: "B", scope: ["b.ts"], acceptanceCriteria: ["c2"] },
    ]);
    const plan = parsePlan(raw);
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({ step: 1, objective: "A", scope: ["a.ts"] });
    expect(plan[1]).toMatchObject({ step: 2, objective: "B" });
  });

  it("rejects a non-JSON response", () => {
    expect(() => parsePlan("I cannot plan this.")).toThrow(SubagentProtocolError);
  });

  it("rejects a JSON response that is not an array", () => {
    expect(() => parsePlan('{"steps": []}')).toThrow(SubagentProtocolError);
  });

  it("rejects a step with an empty objective", () => {
    const raw = JSON.stringify([{ step: 1, objective: "", scope: ["a.ts"], acceptanceCriteria: [] }]);
    expect(() => parsePlan(raw)).toThrow(/objective/);
  });

  it("rejects a step with empty scope", () => {
    const raw = JSON.stringify([{ step: 1, objective: "A", scope: [], acceptanceCriteria: [] }]);
    expect(() => parsePlan(raw)).toThrow(/scope/i);
  });
});

describe("buildImplementPrompt", () => {
  it("embeds one step, its scope, the spec reference, and the artifact JSON shape", () => {
    const prompt = buildImplementPrompt(
      { step: 1, objective: "Create the demo.", scope: ["docs/demo.md"], acceptanceCriteria: ["file exists"] },
      "odd/tasks/demo.md",
    );
    expect(prompt).toContain("cowork-implementer");
    expect(prompt).toContain("Create the demo.");
    expect(prompt).toContain("docs/demo.md");
    expect(prompt).toContain("odd/tasks/demo.md");
    expect(prompt).toContain('"filesModified"');
    expect(prompt).toContain('"changesSummary"');
  });
});

describe("parseArtifact", () => {
  it("parses a valid artifact", () => {
    const artifact = parseArtifact(ARTIFACT_JSON);
    expect(artifact.filesModified).toEqual(["docs/phase2-demo.md"]);
    expect(artifact.changesSummary).toBe("Created the demo file.");
  });

  it("rejects a non-JSON response", () => {
    expect(() => parseArtifact("done, trust me")).toThrow(SubagentProtocolError);
  });

  it("rejects an artifact without changesSummary", () => {
    const raw = JSON.stringify({ filesModified: [], stepsCompleted: [] });
    expect(() => parseArtifact(raw)).toThrow(/changesSummary/);
  });

  it("rejects filesModified entries that are not strings", () => {
    const raw = JSON.stringify({ filesModified: [42], changesSummary: "ok", stepsCompleted: [] });
    expect(() => parseArtifact(raw)).toThrow(SubagentProtocolError);
  });
});

describe("buildStepVerifyPrompt", () => {
  it("embeds the contract id, step criteria, artifact summary, and verdict shape", () => {
    const prompt = buildStepVerifyPrompt(
      "cc-1",
      { step: 1, objective: "Create the demo.", scope: ["docs/demo.md"], acceptanceCriteria: ["file exists"] },
      { filesModified: ["docs/demo.md"], changesSummary: "Created it.", stepsCompleted: ["x"] },
      "odd/tasks/demo.md",
    );
    expect(prompt).toContain("cowork-verifier");
    expect(prompt).toContain("cc-1");
    expect(prompt).toContain("file exists");
    expect(prompt).toContain("Created it.");
    expect(prompt).toContain('"APPROVE"');
    expect(prompt).toContain('"CHANGES"');
  });
});

describe("runPlanner / runImplementer", () => {
  it("runPlanner returns parsed steps and stops the client", async () => {
    const { connect, calls } = createDispatchingConnect({ planner: PLAN_JSON });
    const deps = createDeps(connect);
    const plan = await runPlanner("Create the demo.", "odd/tasks/demo.md", deps.connect(deps.spawnOptions));
    expect(plan).toHaveLength(1);
    expect(plan[0]?.scope).toEqual(["docs/phase2-demo.md"]);
    expect(calls[0]).toContain("cowork-planner");
  });

  it("runImplementer returns the parsed artifact and stops the client", async () => {
    const { connect } = createDispatchingConnect({ implementer: ARTIFACT_JSON });
    const deps = createDeps(connect);
    const artifact = await runImplementer(
      { step: 1, objective: "Create the demo.", scope: ["docs/phase2-demo.md"], acceptanceCriteria: ["exists"] },
      "odd/tasks/demo.md",
      deps.connect(deps.spawnOptions),
    );
    expect(artifact.changesSummary).toBe("Created the demo file.");
  });
});

describe("runChain", () => {
  it("completes a single-step chain on the first attempt (plan + implement + verify)", async () => {
    const { connect } = createDispatchingConnect({});
    const deps = createDeps(connect);
    const result = await runChain("Create the demo.", "odd/tasks/demo.md", deps);
    expect(result.status).toBe("completed");
    expect(result.plan).toHaveLength(1);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ step: 1, attempts: 1, status: "completed" });
  });

  it("retries the implementer after a CHANGES verdict and records the attempt count", async () => {
    let verdictCalls = 0;
    const { connect } = createDispatchingConnect({
      verifier: (message) => {
        verdictCalls += 1;
        return verdictCalls <= 2 ? changesFor(message) : approveFor(message);
      },
    });
    const deps = createDeps(connect);
    const result = await runChain("Create the demo.", "odd/tasks/demo.md", deps);
    expect(result.status).toBe("completed");
    expect(result.steps[0]).toMatchObject({ attempts: 3, status: "completed" });
    expect(verdictCalls).toBe(3);
  });

  it("fails the step and the chain when retries are exhausted", async () => {
    const { connect } = createDispatchingConnect({ verifier: changesFor });
    const deps = createDeps(connect, 3);
    const result = await runChain("Create the demo.", "odd/tasks/demo.md", deps);
    expect(result.status).toBe("failed");
    expect(result.steps[0]).toMatchObject({ attempts: 3, status: "failed" });
    const finalVerdict = result.steps[0]?.verdict;
    expect(finalVerdict?.outcome).toBe("CHANGES");
  });

  it("runs multi-step plans in order", async () => {
    const twoStepPlan = JSON.stringify([
      { step: 1, objective: "First change.", scope: ["docs/a.md"], acceptanceCriteria: ["a exists"] },
      { step: 2, objective: "Second change.", scope: ["docs/b.md"], acceptanceCriteria: ["b exists"] },
    ]);
    const { connect } = createDispatchingConnect({ planner: twoStepPlan });
    const deps = createDeps(connect);
    const result = await runChain("Two changes.", "odd/tasks/demo.md", deps);
    expect(result.status).toBe("completed");
    expect(result.steps.map((s) => s.step)).toEqual([1, 2]);
  });

  it("reports progress through the onProgress callback", async () => {
    const progress: string[] = [];
    const { connect } = createDispatchingConnect({});
    const deps = createDeps(connect);
    await runChain("Create the demo.", "odd/tasks/demo.md", deps, (line) => progress.push(line));
    const joined = progress.join("\n");
    expect(progress.length).toBeGreaterThanOrEqual(3);
    expect(joined).toContain("planner");
    expect(joined).toContain("APPROVE");
  });

  it("uses the Phase 2 test objective with a concrete repository path", () => {
    expect(PHASE2_TEST_OBJECTIVE.length).toBeGreaterThan(20);
    expect(PHASE2_TEST_OBJECTIVE).toContain("docs/phase2-demo.md");
  });
});
