/**
 * Phase 7 Slice 7.3 — Architectural Context Injection
 *
 * Types and functions for injecting architectural context (decisions + tech debt)
 * into TaskContracts when assigning to workers.
 */

import type { DecisionGraph, DecisionNode } from "./architectural-memory.ts";
import { validateDecisionGraph } from "./architectural-memory.ts";
import type { TechDebtGraph, TechDebtNode } from "./tech-debt.ts";
import { validateTechDebtGraph } from "./tech-debt.ts";

/** Dependency between a decision and a tech debt item. */
export interface ArchitecturalDependency {
  /** Source node ID (decision or debt). */
  from: string;
  /** Target node ID (decision or debt). */
  to: string;
  /** Type of dependency. */
  type: "depends_on" | "mitigates" | "blocks" | "decision_mitigates_debt" | "debt_affects_decision";
}

/** The architectural context injected into a TaskContract. */
export interface ArchitecturalContext {
  /** Subgraph of decisions relevant to the contract (transitive closure). */
  decisions: DecisionGraph;
  /** Tech debt items linked to the contract (via affectedContracts). */
  techDebt: TechDebtGraph;
  /** Cross-references between decisions and tech debt. */
  dependencies: ArchitecturalDependency[];
}

/** Configuration for context injection. */
export interface ContextInjectionConfig {
  /** Include decision subgraph (default: true). */
  includeDecisions?: boolean;
  /** Include tech debt (default: true). */
  includeTechDebt?: boolean;
  /** Include cross-dependencies (default: true). */
  includeDependencies?: boolean;
  /** Maximum transitive depth for decisions (default: 3). */
  maxDepth?: number;
}

/** Default configuration for context injection. */
export const DEFAULT_CONTEXT_INJECTION_CONFIG: Required<ContextInjectionConfig> = {
  includeDecisions: true,
  includeTechDebt: true,
  includeDependencies: true,
  maxDepth: 3,
};

/** Validates an ArchitecturalContext (fail-closed). */
export function validateArchitecturalContext(ctx: unknown): ctx is ArchitecturalContext {
  if (typeof ctx !== "object" || ctx === null) return false;
  const c = ctx as Record<string, unknown>;

  // decisions must be a valid DecisionGraph
  if (!c.decisions || typeof c.decisions !== "object") return false;
  if (!validateDecisionGraph(c.decisions)) return false;

  // techDebt must be a valid TechDebtGraph
  if (!c.techDebt || typeof c.techDebt !== "object") return false;
  if (!validateTechDebtGraph(c.techDebt)) return false;

  // dependencies must be array with valid structure
  if (!Array.isArray(c.dependencies)) return false;
  for (const dep of c.dependencies) {
    if (typeof dep !== "object" || dep === null) return false;
    const d = dep as Record<string, unknown>;
    if (typeof d.from !== "string" || typeof d.to !== "string" || typeof d.type !== "string") return false;
  }

  // Verify that all dependencies reference existing nodes
  const allNodeIds = new Set([
    ...(c.decisions as any).nodes.map((n: any) => n.id),
    ...(c.techDebt as any).nodes.map((n: any) => n.id),
  ]);
  for (const dep of c.dependencies) {
    const d = dep as Record<string, unknown>;
    if (!allNodeIds.has(d.from) || !allNodeIds.has(d.to)) return false;
  }

  return true;
}

/**
 * Computes the architectural context for a given contract.
 * Returns the transitive closure of decisions affecting the contract,
 * tech debt linked to the contract, and cross-dependencies.
 */
export function computeArchitecturalContext(
  blackboard: {
    decisions: { nodes: any[]; edges: any[] };
    techDebt: { nodes: any[]; edges: any[] };
    contracts: Map<string, any>;
  },
  contractId: string,
  config: ContextInjectionConfig = {}
): ArchitecturalContext {
  const cfg = { ...DEFAULT_CONTEXT_INJECTION_CONFIG, ...config };

  // Get the contract
  const contract = blackboard.contracts.get(contractId);
  if (!contract) {
    return { decisions: { nodes: [], edges: [] }, techDebt: { nodes: [], edges: [] }, dependencies: [] };
  }

  // 1. Find decisions affecting this contract (directly or transitively)
  const relevantDecisions = findRelevantDecisions(blackboard.decisions, contractId, cfg.maxDepth);

  // 2. Find tech debt linked to this contract
  const relevantTechDebt = findRelevantTechDebt(blackboard.techDebt, contractId);

  // 3. Compute cross-dependencies
  const dependencies = computeDependencies(
    blackboard.decisions.nodes,
    blackboard.techDebt.nodes,
    relevantDecisions,
    relevantTechDebt
  );

  return {
    decisions: {
      nodes: relevantDecisions,
      edges: relevantDecisions.flatMap(d =>
        blackboard.decisions.edges
          .filter(e => relevantDecisions.some(rd => rd.id === e.from) && relevantDecisions.some(rd => rd.id === e.to))
          .map(e => ({ from: e.from, to: e.to, type: e.type }))
      ),
    },
    techDebt: {
      nodes: relevantTechDebt,
      edges: blackboard.techDebt.edges.filter(e =>
        relevantTechDebt.some(rd => rd.id === e.from) && relevantTechDebt.some(rd => rd.id === e.to)
      ),
    },
    dependencies,
  };
/** Finds all decisions that affect the given contract (transitive closure up to maxDepth). */
function findRelevantDecisions(
  decisionsGraph: { nodes: any[]; edges: any[] },
  contractId: string,
  maxDepth: number
): any[] {
  // Directly affected decisions
  const directlyAffected = decisionsGraph.nodes.filter(d =>
    d.affectedContracts && d.affectedContracts.includes(contractId)
  );

  // Build adjacency for transitive closure
  const adj = new Map<string, string[]>();
  for (const edge of decisionsGraph.edges) {
    if (!adj.has(edge.from)) adj.set(edge.from, []);
    adj.get(edge.from)!.push(edge.to);
  }

  // BFS from directly affected nodes to get transitive closure
  const relevant = new Set<string>();
  const queue: { id: string; depth: number }[] = [];

  for (const dec of directlyAffected) {
    relevant.add(dec.id);
    queue.push({ id: dec.id, depth: 0 });
  }

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= 3) continue; // maxDepth default is 3

    const neighbors = adj.get(id) ?? [];
    for (const neighbor of neighbors) {
      if (!relevant.has(neighbor)) {
        relevant.add(neighbor);
        queue.push({ id: neighbor, depth: depth + 1 });
      }
    }
  }

  return decisionsGraph.nodes.filter(d => relevant.has(d.id));
}

/** Finds all tech debt items linked to the given contract. */
function findRelevantTechDebt(techDebtGraph: { nodes: any[]; edges: any[] }, contractId: string): any[] {
  return techDebtGraph.nodes.filter(d =>
    d.affectedContracts && d.affectedContracts.includes(contractId)
  );
}

/** Computes cross-dependencies between decisions and tech debt. */
function computeDependencies(
  allDecisions: any[],
  allTechDebt: any[],
  relevantDecisions: any[],
  relevantTechDebt: any[]
): any[] {
  const dependencies: any[] = [];

  // Heuristic: if a decision's codeRefs overlap with a debt's codeRefs,
  // they are related
  for (const dec of relevantDecisions) {
    for (const debt of relevantTechDebt) {
      const decRefs = new Set(dec.codeRefs ?? []);
      const debtRefs = new Set(debt.codeRefs ?? []);

      for (const ref of decRefs) {
        if (debtRefs.has(ref)) {
          dependencies.push({
            from: dec.id,
            to: debt.id,
            type: "decision_mitigates_debt",
          });
        }
      }
    }
  }

  return dependencies;
}}
