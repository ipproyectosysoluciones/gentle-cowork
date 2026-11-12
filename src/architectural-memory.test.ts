/**
 * Phase 7 Slice 7.1 — Architectural Memory Types Tests (RED phase)
 *
 * Tests for DecisionNode, DecisionEdge, DecisionGraph, DecisionState types,
 * fail-closed validation, and v3→v4 migration.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  DecisionNode,
  DecisionEdge,
  DecisionGraph,
  DecisionState,
  validateDecisionNode,
  validateDecisionEdge,
  validateDecisionGraph,
  validateDecisionState,
  createDecisionNode,
  createDecisionEdge,
  migrateBlackboardStateV3toV4,
  getDecisionGraphValidationErrors,
  type BlackboardStateV3,
  type BlackboardStateV4,
} from "./architectural-memory.ts";

describe("DecisionNode", () => {
  const validNode: DecisionNode = {
    id: "dec-1",
    title: "Use JSON schema for ProjectContract",
    state: "accepted",
    justification: "Versioned schema with migration matches blackboard pattern",
    affectedContracts: ["gc-1", "gc-2"],
    codeRefs: ["src/contract/schema.ts:1", "src/contract/schema.test.ts:10"],
    timestamp: "2026-11-12T10:00:00.000Z",
    author: "owner",
  };

  it("accepts a valid decision node", () => {
    expect(validateDecisionNode(validNode)).toBe(true);
  });

  it("rejects node with missing id", () => {
    const node = { ...validNode, id: "" };
    expect(validateDecisionNode(node)).toBe(false);
  });

  it("rejects node with missing title", () => {
    const node = { ...validNode, title: "" };
    expect(validateDecisionNode(node)).toBe(false);
  });

  it("rejects node with missing justification", () => {
    const node = { ...validNode, justification: "" };
    expect(validateDecisionNode(node)).toBe(false);
  });

  it("rejects node with invalid state", () => {
    const node = { ...validNode, state: "invalid" as DecisionNode["state"] };
    expect(validateDecisionNode(node)).toBe(false);
  });

  it("rejects node with missing timestamp", () => {
    const node = { ...validNode, timestamp: "" };
    expect(validateDecisionNode(node)).toBe(false);
  });

  it("rejects node with missing author", () => {
    const node = { ...validNode, author: "" };
    expect(validateDecisionNode(node)).toBe(false);
  });

  it("rejects node with non-array affectedContracts", () => {
    const node = { ...validNode, affectedContracts: "not-array" as unknown as string[] };
    expect(validateDecisionNode(node)).toBe(false);
  });

  it("rejects node with non-array codeRefs", () => {
    const node = { ...validNode, codeRefs: "not-array" as unknown as string[] };
    expect(validateDecisionNode(node)).toBe(false);
  });

  it("accepts node with empty affectedContracts and codeRefs", () => {
    const node = { ...validNode, affectedContracts: [], codeRefs: [] };
    expect(validateDecisionNode(node)).toBe(true);
  });

  it("accepts all valid states", () => {
    for (const state of ["proposed", "accepted", "rejected", "superseded"] as const) {
      const node = { ...validNode, state };
      expect(validateDecisionNode(node)).toBe(true);
    }
  });
});

describe("DecisionEdge", () => {
  const validEdge: DecisionEdge = {
    from: "dec-1",
    to: "dec-2",
    type: "depends_on",
  };

  it("accepts a valid decision edge", () => {
    expect(validateDecisionEdge(validEdge)).toBe(true);
  });

  it("rejects edge with missing from", () => {
    const edge = { ...validEdge, from: "" };
    expect(validateDecisionEdge(edge)).toBe(false);
  });

  it("rejects edge with missing to", () => {
    const edge = { ...validEdge, to: "" };
    expect(validateDecisionEdge(edge)).toBe(false);
  });

  it("rejects edge with invalid type", () => {
    const edge = { ...validEdge, type: "invalid" as DecisionEdge["type"] };
    expect(validateDecisionEdge(edge)).toBe(false);
  });

  it("accepts all valid edge types", () => {
    for (const type of ["depends_on", "supersedes", "blocks", "relates_to"] as const) {
      const edge = { ...validEdge, type };
      expect(validateDecisionEdge(edge)).toBe(true);
    }
  });

  it("rejects self-loop (from === to)", () => {
    const edge = { ...validEdge, to: "dec-1" };
    expect(validateDecisionEdge(edge)).toBe(false);
  });
});

describe("DecisionGraph", () => {
  const nodes: DecisionNode[] = [
    { id: "dec-1", title: "Decision 1", state: "accepted", justification: "j1", affectedContracts: [], codeRefs: [], timestamp: "2026-11-12T10:00:00.000Z", author: "owner" },
    { id: "dec-2", title: "Decision 2", state: "proposed", justification: "j2", affectedContracts: [], codeRefs: [], timestamp: "2026-11-12T11:00:00.000Z", author: "owner" },
    { id: "dec-3", title: "Decision 3", state: "rejected", justification: "j3", affectedContracts: [], codeRefs: [], timestamp: "2026-11-12T12:00:00.000Z", author: "owner" },
  ];

  const edges: DecisionEdge[] = [
    { from: "dec-2", to: "dec-1", type: "depends_on" },
    { from: "dec-3", to: "dec-1", type: "supersedes" },
  ];

  const validGraph: DecisionGraph = { nodes, edges };

  it("accepts a valid decision graph", () => {
    expect(validateDecisionGraph(validGraph)).toBe(true);
  });

  it("rejects graph with invalid node", () => {
    const graph = { ...validGraph, nodes: [{ ...nodes[0], id: "" }] };
    expect(validateDecisionGraph(graph)).toBe(false);
  });

  it("rejects graph with invalid edge", () => {
    const graph = { ...validGraph, edges: [{ ...edges[0], from: "" }] };
    expect(validateDecisionGraph(graph)).toBe(false);
  });

  it("rejects graph with edge referencing non-existent node", () => {
    const graph = { ...validGraph, edges: [{ ...edges[0], from: "dec-999" }] };
    expect(validateDecisionGraph(graph)).toBe(false);
  });

  it("rejects graph with duplicate node ids", () => {
    const graph = { ...validGraph, nodes: [...nodes, { ...nodes[0] }] };
    expect(validateDecisionGraph(graph)).toBe(false);
  });

  it("rejects graph with duplicate edge (same from, to, type)", () => {
    const graph = { ...validGraph, edges: [...edges, { ...edges[0] }] };
    expect(validateDecisionGraph(graph)).toBe(false);
  });

  it("accepts empty graph", () => {
    expect(validateDecisionGraph({ nodes: [], edges: [] })).toBe(true);
  });
});

describe("DecisionState", () => {
  const validState: DecisionState = {
    decisions: {
      nodes: [
        { id: "dec-1", title: "Decision 1", state: "accepted", justification: "j1", affectedContracts: [], codeRefs: [], timestamp: "2026-11-12T10:00:00.000Z", author: "owner" },
      ],
      edges: [],
    },
    version: 4,
  };

  it("accepts valid decision state", () => {
    const state: DecisionState = {
      decisions: {
        nodes: [
          { id: "dec-1", title: "Decision 1", state: "accepted", justification: "j1", affectedContracts: [], codeRefs: [], timestamp: "2026-11-12T10:00:00.000Z", author: "owner" },
        ],
        edges: [],
      },
      version: 4,
    };
    expect(validateDecisionState(state)).toBe(true);
  });

  it("rejects decision state with wrong version", () => {
    const state = { decisions: { nodes: [], edges: [] }, version: 3 };
    expect(validateDecisionState(state)).toBe(false);
  });

  it("rejects decision state with invalid graph", () => {
    const state = { decisions: { nodes: [{ id: "" }], edges: [] }, version: 4 };
    expect(validateDecisionState(state)).toBe(false);
  });
});

describe("BlackboardState v3→v4 Migration", () => {
  const v3State: BlackboardStateV3 = {
    version: 3,
    contracts: [
      { id: "gc-1", objective: "test", role: "planner", scope: [], acceptanceCriteria: [], specRef: "odd/tasks/test.md", artifacts: [], status: "pending", version: 1, history: [] },
    ],
    lease: undefined,
    nodes: [],
    lastFence: 0,
    usage: {},
  };

  it("migrates v3 state to v4 with empty decisions", () => {
    const v4 = migrateBlackboardStateV3toV4(v3State);
    expect(v4.version).toBe(4);
    expect(v4.decisions).toEqual({ nodes: [], edges: [] });
    expect(v4.contracts).toEqual(v3State.contracts);
    expect(v4.lease).toEqual(v3State.lease);
    expect(v4.nodes).toEqual(v3State.nodes);
    expect(v4.lastFence).toEqual(v3State.lastFence);
    expect(v4.usage).toEqual(v3State.usage);
  });

  it("migrates v3 state with existing lease and nodes", () => {
    const v3WithExtras: BlackboardStateV3 = {
      ...v3State,
      lease: { holderNodeId: "master", acquiredAt: "2026-11-12T10:00:00.000Z", expiresAt: "2026-11-12T10:30:00.000Z", fence: 123 },
      nodes: [{ nodeId: "worker-1", role: "worker", capabilities: ["implementer"], startedAt: "2026-11-12T10:00:00.000Z", lastHeartbeat: "2026-11-12T10:05:00.000Z", status: "alive" }],
      lastFence: 456,
      usage: { "gc-1": { modelCalls: 10, tokens: 1000, wallTimeMs: 5000, events: 10, byNode: {} } },
    };
    const v4 = migrateBlackboardStateV3toV4(v3WithExtras);
    expect(v4.version).toBe(4);
    expect(v4.decisions).toEqual({ nodes: [], edges: [] });
    expect(v4.lease).toEqual(v3WithExtras.lease);
    expect(v4.nodes).toEqual(v3WithExtras.nodes);
    expect(v4.lastFence).toBe(456);
    expect(v4.usage).toEqual(v3WithExtras.usage);
  });

  it("throws on invalid v3 state (wrong version)", () => {
    const invalid = { ...v3State, version: 2 };
    expect(() => migrateBlackboardStateV3toV4(invalid as BlackboardStateV3)).toThrow(/version/);
  });

  it("throws on non-object input", () => {
    expect(() => migrateBlackboardStateV3toV4(null as unknown as BlackboardStateV3)).toThrow();
    expect(() => migrateBlackboardStateV3toV4("not-object" as unknown as BlackboardStateV3)).toThrow();
  });
});

describe("DecisionNode helpers", () => {
  it("creates a minimal valid node", () => {
    const node = createDecisionNode({
      id: "dec-1",
      title: "Test Decision",
      state: "accepted",
      justification: "Test justification",
      author: "owner",
    });
    expect(node.id).toBe("dec-1");
    expect(node.state).toBe("accepted");
    expect(validateDecisionNode(node)).toBe(true);
  });

  it("rejects node with empty title", () => {
    expect(() => createDecisionNode({
      id: "dec-1",
      title: "",
      state: "accepted",
      justification: "Test",
      author: "owner",
    })).toThrow();
  });
});

describe("DecisionEdge helpers", () => {
  it("creates a valid edge", () => {
    const edge = createDecisionEdge({
      from: "dec-1",
      to: "dec-2",
      type: "depends_on",
    });
    expect(edge.from).toBe("dec-1");
    expect(edge.to).toBe("dec-2");
    expect(validateDecisionEdge(edge)).toBe(true);
  });

  it("rejects self-loop edge", () => {
    expect(() => createDecisionEdge({
      from: "dec-1",
      to: "dec-1",
      type: "depends_on",
    })).toThrow();
  });
});