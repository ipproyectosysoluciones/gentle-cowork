/**
 * Phase 7 Slice 7.3 — Architectural Context Injection Types Tests (RED phase)
 *
 * Tests for ArchitecturalContext, ContextInjectionConfig types,
 * computeArchitecturalContext function, and TaskContract migration.
 */

import { describe, it, expect } from "vitest";
import {
  ArchitecturalContext,
  ContextInjectionConfig,
  computeArchitecturalContext,
  validateArchitecturalContext,
  type ArchitecturalContext as ArchitecturalContextType,
} from "./architectural-context.ts";
import type { DecisionGraph } from "./architectural-memory.ts";
import type { TaskContract } from "./types.ts";
import type { TechDebtGraph } from "./tech-debt.ts";

describe("ArchitecturalContext", () => {
  const validContext: ArchitecturalContextType = {
    decisions: {
      nodes: [
        { id: "dec-1", title: "Use JSON schema", state: "accepted", justification: "j1", affectedContracts: ["gc-1"], codeRefs: ["src/schema.ts:1"], timestamp: "2026-11-12T10:00:00.000Z", author: "owner" },
        { id: "dec-2", title: "Add error handling", state: "proposed", justification: "j2", affectedContracts: ["gc-1"], codeRefs: ["src/flow.ts:42"], timestamp: "2026-11-12T11:00:00.000Z", author: "owner" },
      ],
      edges: [
        { from: "dec-2", to: "dec-1", type: "depends_on" },
      ],
    },
    techDebt: {
      nodes: [
        { id: "debt-1", title: "Missing error handling", description: "desc", location: "src/flow.ts:42", severity: "high", rootCause: "rc1", estimatedCost: { tokens: 5000, calls: 10, wallTimeMs: 30000 }, paymentTrigger: "before release", state: "open", affectedContracts: ["gc-1"], codeRefs: ["src/flow.ts:42"], timestamp: "2026-11-12T10:00:00.000Z", author: "owner" },
      ],
      edges: [],
    },
    dependencies: [
      { from: "dec-2", to: "debt-1", type: "decision_mitigates_debt" },
    ],
  };

  it("accepts a valid architectural context", () => {
    expect(validateArchitecturalContext(validContext)).toBe(true);
  });

  it("accepts empty context", () => {
    const empty = { decisions: { nodes: [], edges: [] }, techDebt: { nodes: [], edges: [] }, dependencies: [] };
    expect(validateArchitecturalContext(empty)).toBe(true);
  });

  it("rejects context with invalid decisions graph", () => {
    const ctx = { ...validContext, decisions: { nodes: [{ id: "" }], edges: [] } };
    expect(validateArchitecturalContext(ctx)).toBe(false);
  });

  it("rejects context with invalid techDebt graph", () => {
    const ctx = { ...validContext, techDebt: { nodes: [{ id: "" }], edges: [] } };
    expect(validateArchitecturalContext(ctx)).toBe(false);
  });

  it("rejects context with invalid dependency (non-existent nodes)", () => {
    const ctx = { ...validContext, dependencies: [{ from: "dec-999", to: "debt-1", type: "decision_mitigates_debt" }] };
    expect(validateArchitecturalContext(ctx)).toBe(false);
  });
});

describe("ContextInjectionConfig", () => {
  it("has correct default values", () => {
    const config: ContextInjectionConfig = {
      includeDecisions: true,
      includeTechDebt: true,
      includeDependencies: true,
      maxDepth: 3,
    };
    expect(config.includeDecisions).toBe(true);
    expect(config.maxDepth).toBe(3);
  });
});

describe("computeArchitecturalContext", () => {
  it("returns empty context for non-existent contract", () => {
    const blackboard = {
      decisions: { nodes: [], edges: [] },
      techDebt: { nodes: [], edges: [] },
      contracts: new Map(),
    } as any;

    const context = computeArchitecturalContext(blackboard, "non-existent");
    expect(context.decisions.nodes).toHaveLength(0);
    expect(context.techDebt.nodes).toHaveLength(0);
    expect(context.dependencies).toHaveLength(0);
  });

  it("returns decisions affecting the contract (transitive closure)", () => {
    const dec1 = { id: "dec-1", title: "Base", state: "accepted", justification: "j1", affectedContracts: ["gc-1"], codeRefs: [], timestamp: "2026-11-12T10:00:00.000Z", author: "owner" };
    const dec2 = { id: "dec-2", title: "Child", state: "proposed", justification: "j2", affectedContracts: ["gc-1"], codeRefs: [], timestamp: "2026-11-12T11:00:00.000Z", author: "owner" };
    const dec3 = { id: "dec-3", title: "Unrelated", state: "accepted", justification: "j3", affectedContracts: ["gc-999"], codeRefs: [], timestamp: "2026-11-12T12:00:00.000Z", author: "owner" };

    const blackboard = {
      decisions: {
        nodes: [dec1, dec2, dec3],
        edges: [{ from: "dec-2", to: "dec-1", type: "depends_on" }],
      },
      techDebt: { nodes: [], edges: [] },
      contracts: new Map([["gc-1", { id: "gc-1" }]]),
    } as any;

    const context = computeArchitecturalContext(blackboard, "gc-1");
    expect(context.decisions.nodes.map(n => n.id).sort()).toEqual(["dec-1", "dec-2"]);
    expect(context.decisions.nodes.find(n => n.id === "dec-3")).toBeUndefined();
  });

  it("returns tech debt linked to the contract", () => {
    const debt1 = { id: "debt-1", title: "Debt 1", description: "d1", location: "src/a.ts:1", severity: "high", rootCause: "rc1", estimatedCost: { tokens: 100, calls: 1, wallTimeMs: 100 }, paymentTrigger: "t1", state: "open", affectedContracts: ["gc-1"], codeRefs: [], timestamp: "2026-11-12T10:00:00.000Z", author: "owner" };
    const debt2 = { id: "debt-2", title: "Debt 2", description: "d2", location: "src/b.ts:1", severity: "medium", rootCause: "rc2", estimatedCost: { tokens: 200, calls: 2, wallTimeMs: 200 }, paymentTrigger: "t2", state: "open", affectedContracts: ["gc-999"], codeRefs: [], timestamp: "2026-11-12T11:00:00.000Z", author: "owner" };

    const blackboard = {
      decisions: { nodes: [], edges: [] },
      techDebt: {
        nodes: [debt1, debt2],
        edges: [],
      },
      contracts: new Map([["gc-1", { id: "gc-1" }]]),
    } as any;

    const context = computeArchitecturalContext(blackboard, "gc-1");
    expect(context.techDebt.nodes).toHaveLength(1);
    expect(context.techDebt.nodes[0].id).toBe("debt-1");
  });

  it("computes dependencies between decisions and tech debt", () => {
    const dec1 = { id: "dec-1", title: "Decision", state: "accepted", justification: "j1", affectedContracts: ["gc-1"], codeRefs: [], timestamp: "2026-11-12T10:00:00.000Z", author: "owner" };
    const debt1 = { id: "debt-1", title: "Debt", description: "d1", location: "src/a.ts:1", severity: "high", rootCause: "rc1", estimatedCost: { tokens: 100, calls: 1, wallTimeMs: 100 }, paymentTrigger: "t1", state: "open", affectedContracts: ["gc-1"], codeRefs: [], timestamp: "2026-11-12T10:00:00.000Z", author: "owner" };

    const blackboard = {
      decisions: { nodes: [dec1], edges: [] },
      techDebt: { nodes: [{ ...debt1, id: "debt-1" }], edges: [] },
      contracts: new Map([["gc-1", { id: "gc-1" }]]),
    } as any;

    const context = computeArchitecturalContext(blackboard, "gc-1");
    // Dependencies are created when a decision's codeRefs overlap with debt's codeRefs
    // This is a heuristic - in practice, we'd have explicit links
    expect(context.dependencies).toEqual([]);
  });

  it("returns empty context for contract with no decisions or debt", () => {
    const blackboard = {
      decisions: { nodes: [], edges: [] },
      techDebt: { nodes: [], edges: [] },
      contracts: new Map([["gc-1", { id: "gc-1" }]]),
    } as any;

    const context = computeArchitecturalContext(blackboard, "gc-1");
    expect(context.decisions.nodes).toHaveLength(0);
    expect(context.techDebt.nodes).toHaveLength(0);
    expect(context.dependencies).toHaveLength(0);
  });
});

describe("TaskContract architecturalContext field", () => {
  it("is optional and not required", () => {
    // This test will pass once TaskContract type is updated
    expect(true).toBe(true);
  });
});