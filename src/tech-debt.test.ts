/**
 * Phase 7 Slice 7.2 — Tech Debt Registry Types Tests (RED phase)
 *
 * Tests for TechDebtNode, TechDebtEdge, TechDebtGraph, TechDebtState types,
 * fail-closed validation, and v4→v5 migration.
 */

import { describe, it, expect } from "vitest";
import {
  TechDebtNode,
  TechDebtEdge,
  TechDebtGraph,
  TechDebtState,
  validateTechDebtNode,
  validateTechDebtEdge,
  validateTechDebtGraph,
  validateTechDebtState,
  createTechDebtNode,
  createTechDebtEdge,
  migrateBlackboardStateV4toV5,
  getTechDebtGraphValidationErrors,
  type BlackboardStateV4,
  type BlackboardStateV5,
  VALID_DEBT_SEVERITIES,
  VALID_DEBT_STATES,
  VALID_DEBT_EDGE_TYPES,
} from "./tech-debt.ts";

describe("VALID_DEBT_SEVERITIES", () => {
  it("contains expected severities", () => {
    expect(VALID_DEBT_SEVERITIES).toEqual(["critical", "high", "medium", "low"]);
  });
});

describe("VALID_DEBT_STATES", () => {
  it("contains expected states", () => {
    expect(VALID_DEBT_STATES).toEqual(["open", "acknowledged", "paid", "waived"]);
  });
});

describe("VALID_DEBT_EDGE_TYPES", () => {
  it("contains expected edge types", () => {
    expect(VALID_DEBT_EDGE_TYPES).toEqual(["depends_on", "blocks", "duplicates", "mitigates"]);
  });
});

describe("TechDebtNode", () => {
  const validNode: TechDebtNode = {
    id: "debt-1",
    title: "Missing error handling in payment flow",
    description: "The payment flow does not handle network timeouts gracefully",
    location: "src/payment/flow.ts:42",
    severity: "high",
    rootCause: "Timeout handling omitted during initial implementation",
    estimatedCost: { tokens: 5000, calls: 10, wallTimeMs: 30000 },
    paymentTrigger: "before next payment feature release",
    state: "open",
    affectedContracts: ["gc-1", "gc-2"],
    codeRefs: ["src/payment/flow.ts:42", "src/payment/timeout.ts:10"],
    timestamp: "2026-11-12T10:00:00.000Z",
    author: "owner",
  };

  it("accepts a valid tech debt node", () => {
    expect(validateTechDebtNode(validNode)).toBe(true);
  });

  it("rejects node with missing id", () => {
    const node = { ...validNode, id: "" };
    expect(validateTechDebtNode(node)).toBe(false);
  });

  it("rejects node with missing title", () => {
    const node = { ...validNode, title: "" };
    expect(validateTechDebtNode(node)).toBe(false);
  });

  it("rejects node with missing description", () => {
    const node = { ...validNode, description: "" };
    expect(validateTechDebtNode(node)).toBe(false);
  });

  it("rejects node with missing location", () => {
    const node = { ...validNode, location: "" };
    expect(validateTechDebtNode(node)).toBe(false);
  });

  it("rejects node with missing rootCause", () => {
    const node = { ...validNode, rootCause: "" };
    expect(validateTechDebtNode(node)).toBe(false);
  });

  it("rejects node with missing paymentTrigger", () => {
    const node = { ...validNode, paymentTrigger: "" };
    expect(validateTechDebtNode(node)).toBe(false);
  });

  it("rejects node with invalid severity", () => {
    const node = { ...validNode, severity: "invalid" as TechDebtNode["severity"] };
    expect(validateTechDebtNode(node)).toBe(false);
  });

  it("rejects node with invalid state", () => {
    const node = { ...validNode, state: "invalid" as TechDebtNode["state"] };
    expect(validateTechDebtNode(node)).toBe(false);
  });

  it("rejects node with missing timestamp", () => {
    const node = { ...validNode, timestamp: "" };
    expect(validateTechDebtNode(node)).toBe(false);
  });

  it("rejects node with missing author", () => {
    const node = { ...validNode, author: "" };
    expect(validateTechDebtNode(node)).toBe(false);
  });

  it("rejects node with non-array affectedContracts", () => {
    const node = { ...validNode, affectedContracts: "not-array" as unknown as string[] };
    expect(validateTechDebtNode(node)).toBe(false);
  });

  it("rejects node with non-array codeRefs", () => {
    const node = { ...validNode, codeRefs: "not-array" as unknown as string[] };
    expect(validateTechDebtNode(node)).toBe(false);
  });

  it("rejects node with invalid estimatedCost structure", () => {
    const node = { ...validNode, estimatedCost: { tokens: "not-number" as unknown as number } };
    expect(validateTechDebtNode(node)).toBe(false);
  });

  it("accepts all valid severities", () => {
    for (const severity of ["critical", "high", "medium", "low"] as const) {
      const node = { ...validNode, severity };
      expect(validateTechDebtNode(node)).toBe(true);
    }
  });

  it("accepts all valid states", () => {
    for (const state of ["open", "acknowledged", "paid", "waived"] as const) {
      const node = { ...validNode, state };
      expect(validateTechDebtNode(node)).toBe(true);
    }
  });

  it("accepts node with empty affectedContracts and codeRefs", () => {
    const node = { ...validNode, affectedContracts: [], codeRefs: [] };
    expect(validateTechDebtNode(node)).toBe(true);
  });

  it("rejects node with non-ISO8601 timestamp", () => {
    const node = { ...validNode, timestamp: "2026-11-12" };
    expect(validateTechDebtNode(node)).toBe(false);
  });
});

describe("TechDebtEdge", () => {
  const validEdge: TechDebtEdge = {
    from: "debt-1",
    to: "debt-2",
    type: "depends_on",
  };

  it("accepts a valid tech debt edge", () => {
    expect(validateTechDebtEdge(validEdge)).toBe(true);
  });

  it("rejects edge with missing from", () => {
    const edge = { ...validEdge, from: "" };
    expect(validateTechDebtEdge(edge)).toBe(false);
  });

  it("rejects edge with missing to", () => {
    const edge = { ...validEdge, to: "" };
    expect(validateTechDebtEdge(edge)).toBe(false);
  });

  it("rejects edge with invalid type", () => {
    const edge = { ...validEdge, type: "invalid" as TechDebtEdge["type"] };
    expect(validateTechDebtEdge(edge)).toBe(false);
  });

  it("accepts all valid edge types", () => {
    for (const type of ["depends_on", "blocks", "duplicates", "mitigates"] as const) {
      const edge = { ...validEdge, type };
      expect(validateTechDebtEdge(edge)).toBe(true);
    }
  });

  it("rejects self-loop (from === to)", () => {
    const edge = { ...validEdge, to: "debt-1" };
    expect(validateTechDebtEdge(edge)).toBe(false);
  });
});

describe("TechDebtGraph", () => {
  const nodes: TechDebtNode[] = [
    { id: "debt-1", title: "Debt 1", description: "d1", location: "src/a.ts:1", severity: "high", rootCause: "rc1", estimatedCost: { tokens: 100, calls: 1, wallTimeMs: 100 }, paymentTrigger: "trigger1", state: "open", affectedContracts: [], codeRefs: [], timestamp: "2026-11-12T10:00:00.000Z", author: "owner" },
    { id: "debt-2", title: "Debt 2", description: "d2", location: "src/b.ts:1", severity: "medium", rootCause: "rc2", estimatedCost: { tokens: 200, calls: 2, wallTimeMs: 200 }, paymentTrigger: "trigger2", state: "open", affectedContracts: [], codeRefs: [], timestamp: "2026-11-12T11:00:00.000Z", author: "owner" },
    { id: "debt-3", title: "Debt 3", description: "d3", location: "src/c.ts:1", severity: "low", rootCause: "rc3", estimatedCost: { tokens: 300, calls: 3, wallTimeMs: 300 }, paymentTrigger: "trigger3", state: "acknowledged", affectedContracts: [], codeRefs: [], timestamp: "2026-11-12T12:00:00.000Z", author: "owner" },
  ];

  const edges: TechDebtEdge[] = [
    { from: "debt-2", to: "debt-1", type: "depends_on" },
    { from: "debt-3", to: "debt-1", type: "mitigates" },
  ];

  const validGraph: TechDebtGraph = { nodes, edges };

  it("accepts a valid tech debt graph", () => {
    expect(validateTechDebtGraph(validGraph)).toBe(true);
  });

  it("rejects graph with invalid node", () => {
    const graph = { ...validGraph, nodes: [{ ...nodes[0], id: "" }] };
    expect(validateTechDebtGraph(graph)).toBe(false);
  });

  it("rejects graph with invalid edge", () => {
    const graph = { ...validGraph, edges: [{ ...edges[0], from: "" }] };
    expect(validateTechDebtGraph(graph)).toBe(false);
  });

  it("rejects graph with edge referencing non-existent node", () => {
    const graph = { ...validGraph, edges: [{ ...edges[0], from: "debt-999" }] };
    expect(validateTechDebtGraph(graph)).toBe(false);
  });

  it("rejects graph with duplicate node ids", () => {
    const graph = { ...validGraph, nodes: [...nodes, { ...nodes[0] }] };
    expect(validateTechDebtGraph(graph)).toBe(false);
  });

  it("rejects graph with duplicate edge (same from, to, type)", () => {
    const graph = { ...validGraph, edges: [...edges, { ...edges[0] }] };
    expect(validateTechDebtGraph(graph)).toBe(false);
  });

  it("accepts empty graph", () => {
    expect(validateTechDebtGraph({ nodes: [], edges: [] })).toBe(true);
  });
});

describe("TechDebtState", () => {
  const validState: TechDebtState = {
    techDebt: {
      nodes: [
        { id: "debt-1", title: "Debt 1", description: "d1", location: "src/a.ts:1", severity: "high", rootCause: "rc1", estimatedCost: { tokens: 100, calls: 1, wallTimeMs: 100 }, paymentTrigger: "trigger1", state: "open", affectedContracts: [], codeRefs: [], timestamp: "2026-11-12T10:00:00.000Z", author: "owner" },
      ],
      edges: [],
    },
    version: 5,
  };

  it("accepts valid tech debt state", () => {
    expect(validateTechDebtState(validState)).toBe(true);
  });

  it("rejects tech debt state with wrong version", () => {
    const state = { ...validState, version: 4 };
    expect(validateTechDebtState(state)).toBe(false);
  });

  it("rejects tech debt state with invalid graph", () => {
    const invalidNode = { id: "", title: "Debt 1", description: "d1", location: "src/a.ts:1", severity: "high" as const, rootCause: "rc1", estimatedCost: { tokens: 100, calls: 1, wallTimeMs: 100 }, paymentTrigger: "trigger1", state: "open" as const, affectedContracts: [], codeRefs: [], timestamp: "2026-11-12T10:00:00.000Z", author: "owner" };
    const state = { ...validState, techDebt: { nodes: [invalidNode], edges: [] } };
    expect(validateTechDebtState(state)).toBe(false);
  });
});

describe("BlackboardState v4→v5 Migration", () => {
  const v4State: BlackboardStateV4 = {
    version: 4,
    contracts: [
      { id: "gc-1", objective: "test", role: "planner", scope: [], acceptanceCriteria: [], specRef: "odd/tasks/test.md", artifacts: [], status: "pending", version: 1, history: [] },
    ],
    lease: undefined,
    nodes: [],
    lastFence: 0,
    usage: {},
    decisions: { nodes: [], edges: [] },
  };

  it("migrates v4 state to v5 with empty techDebt", () => {
    const v5 = migrateBlackboardStateV4toV5(v4State);
    expect(v5.version).toBe(5);
    expect(v5.techDebt).toEqual({ nodes: [], edges: [] });
    expect(v5.contracts).toEqual(v4State.contracts);
    expect(v5.lease).toEqual(v4State.lease);
    expect(v5.nodes).toEqual(v4State.nodes);
    expect(v5.lastFence).toEqual(v4State.lastFence);
    expect(v5.usage).toEqual(v4State.usage);
    expect(v5.decisions).toEqual(v4State.decisions);
  });

  it("migrates v4 state with existing decisions", () => {
    const v4WithDecisions: BlackboardStateV4 = {
      ...v4State,
      decisions: {
        nodes: [{ id: "dec-1", title: "Decision 1", state: "accepted", justification: "j1", affectedContracts: [], codeRefs: [], timestamp: "2026-11-12T10:00:00.000Z", author: "owner" }],
        edges: [],
      },
    };
    const v5 = migrateBlackboardStateV4toV5(v4WithDecisions);
    expect(v5.version).toBe(5);
    expect(v5.techDebt).toEqual({ nodes: [], edges: [] });
    expect(v5.decisions).toEqual(v4WithDecisions.decisions);
  });

  it("throws on invalid v4 state (wrong version)", () => {
    const invalid = { ...v4State, version: 3 };
    expect(() => migrateBlackboardStateV4toV5(invalid as BlackboardStateV4)).toThrow(/version/);
  });

  it("throws on non-object input", () => {
    expect(() => migrateBlackboardStateV4toV5(null as unknown as BlackboardStateV4)).toThrow();
    expect(() => migrateBlackboardStateV4toV5("not-object" as unknown as BlackboardStateV4)).toThrow();
  });
});

describe("TechDebtNode helpers", () => {
  it("creates a minimal valid node", () => {
    const node = createTechDebtNode({
      id: "debt-1",
      title: "Test Debt",
      description: "Test description",
      location: "src/test.ts:1",
      severity: "high",
      rootCause: "Test root cause",
      paymentTrigger: "before release",
      author: "owner",
    });
    expect(node.id).toBe("debt-1");
    expect(node.severity).toBe("high");
    expect(validateTechDebtNode(node)).toBe(true);
  });

  it("rejects node with empty title", () => {
    expect(() => createTechDebtNode({
      id: "debt-1",
      title: "",
      description: "Test",
      location: "src/test.ts:1",
      severity: "high",
      rootCause: "Test",
      paymentTrigger: "trigger",
      author: "owner",
    })).toThrow();
  });
});

describe("TechDebtEdge helpers", () => {
  it("creates a valid edge", () => {
    const edge = createTechDebtEdge({
      from: "debt-1",
      to: "debt-2",
      type: "depends_on",
    });
    expect(edge.from).toBe("debt-1");
    expect(edge.to).toBe("debt-2");
    expect(validateTechDebtEdge(edge)).toBe(true);
  });

  it("rejects self-loop edge", () => {
    expect(() => createTechDebtEdge({
      from: "debt-1",
      to: "debt-1",
      type: "depends_on",
    })).toThrow();
  });
});