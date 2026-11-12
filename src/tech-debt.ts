/**
 * Phase 7 Slice 7.2 — Tech Debt Registry Types
 *
 * Types for the tech debt graph persisted in the blackboard.
 * Fail-closed validation, v4→v5 migration.
 */

import type { BlackboardState } from "./blackboard.ts";

/** Valid debt severities. */
export type DebtSeverity = "critical" | "high" | "medium" | "low";

/** Valid debt states. */
export type DebtState = "open" | "acknowledged" | "paid" | "waived";

/** Valid edge types in the tech debt graph. */
export type DebtEdgeType = "depends_on" | "blocks" | "duplicates" | "mitigates";

/** Estimated cost for resolving a tech debt item. */
export interface EstimatedCost {
  tokens: number;
  calls: number;
  wallTimeMs: number;
}

/** A node in the tech debt graph. */
export interface TechDebtNode {
  /** Unique identifier (e.g., "debt-1", "debt-abc123"). */
  id: string;

  /** Human-readable title/summary. */
  title: string;

  /** Detailed description. */
  description: string;

  /** Code location: file:line or file:symbol. */
  location: string;

  /** Severity level. */
  severity: DebtSeverity;

  /** Root cause analysis. */
  rootCause: string;

  /** Estimated cost to resolve. */
  estimatedCost: EstimatedCost;

  /** Condition that triggers mandatory resolution. */
  paymentTrigger: string;

  /** Current state of the debt item. */
  state: DebtState;

  /** Contract IDs affected by this debt. */
  affectedContracts: string[];

  /** Code references: file:line or symbol paths. */
  codeRefs: string[];

  /** ISO timestamp when the debt was recorded. */
  timestamp: string;

  /** Author/identity who recorded the debt. */
  author: string;
}

/** A directed edge between two tech debt nodes. */
export interface TechDebtEdge {
  /** Source debt node ID. */
  from: string;

  /** Target debt node ID. */
  to: string;

  /** Relationship type. */
  type: DebtEdgeType;
}

/** The full tech debt graph (nodes + edges). */
export interface TechDebtGraph {
  nodes: TechDebtNode[];
  edges: TechDebtEdge[];
}

/** Tech debt state embedded in the blackboard (v5+). */
export interface TechDebtState {
  techDebt: TechDebtGraph;
  version: 5;
}

/** V4 blackboard state (before techDebt field). */
export interface BlackboardStateV4 {
  version: 4;
  contracts: BlackboardState["contracts"];
  lease?: BlackboardState["lease"];
  nodes: BlackboardState["nodes"];
  lastFence: number;
  usage?: Record<string, BlackboardState["usage"] extends Record<string, infer U> ? U : never>;
  decisions?: BlackboardState["decisions"];
}

/** V5 blackboard state (with techDebt field). */
export interface BlackboardStateV5 extends BlackboardState {
  version: 5;
  techDebt: TechDebtGraph;
}

/** Shared constants for validation - single source of truth. */
export const VALID_DEBT_SEVERITIES: readonly DebtSeverity[] = ["critical", "high", "medium", "low"] as const;
export const VALID_DEBT_STATES: readonly DebtState[] = ["open", "acknowledged", "paid", "waived"] as const;
export const VALID_DEBT_EDGE_TYPES: readonly DebtEdgeType[] = ["depends_on", "blocks", "duplicates", "mitigates"] as const;

/** Validates a TechDebtNode (fail-closed). */
export function validateTechDebtNode(node: unknown): node is TechDebtNode {
  if (typeof node !== "object" || node === null) return false;
  const n = node as Record<string, unknown>;

  // Required string fields, non-empty
  if (typeof n.id !== "string" || n.id.length === 0) return false;
  if (typeof n.title !== "string" || n.title.length === 0) return false;
  if (typeof n.description !== "string" || n.description.length === 0) return false;
  if (typeof n.location !== "string" || n.location.length === 0) return false;
  if (typeof n.rootCause !== "string" || n.rootCause.length === 0) return false;
  if (typeof n.paymentTrigger !== "string" || n.paymentTrigger.length === 0) return false;
  if (typeof n.timestamp !== "string" || n.timestamp.length === 0) return false;
  if (typeof n.author !== "string" || n.author.length === 0) return false;

  // Severity must be one of the valid values
  if (typeof n.severity !== "string" || !VALID_DEBT_SEVERITIES.includes(n.severity as DebtSeverity)) return false;

  // State must be one of the valid values
  if (typeof n.state !== "string" || !VALID_DEBT_STATES.includes(n.state as DebtState)) return false;

  // Arrays
  if (!Array.isArray(n.affectedContracts) || !n.affectedContracts.every((x) => typeof x === "string")) return false;
  if (!Array.isArray(n.codeRefs) || !n.codeRefs.every((x) => typeof x === "string")) return false;

  // Timestamp format validation (strict ISO 8601: YYYY-MM-DDTHH:mm:ss.sssZ)
  const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
  if (!iso8601Regex.test(n.timestamp)) return false;
  const ts = new Date(n.timestamp);
  if (isNaN(ts.getTime())) return false;

  // Estimated cost validation
  if (typeof n.estimatedCost !== "object" || n.estimatedCost === null) return false;
  const cost = n.estimatedCost as Record<string, unknown>;
  if (typeof cost.tokens !== "number" || !Number.isFinite(cost.tokens)) return false;
  if (typeof cost.calls !== "number" || !Number.isFinite(cost.calls)) return false;
  if (typeof cost.wallTimeMs !== "number" || !Number.isFinite(cost.wallTimeMs)) return false;

  return true;
}

/** Validates a TechDebtEdge (fail-closed). */
export function validateTechDebtEdge(edge: unknown, existingNodeIds?: ReadonlySet<string>): edge is TechDebtEdge {
  if (typeof edge !== "object" || edge === null) return false;
  const e = edge as Record<string, unknown>;

  if (typeof e.from !== "string" || e.from.length === 0) return false;
  if (typeof e.to !== "string" || e.to.length === 0) return false;
  if (e.from === e.to) return false; // no self-loops

  if (typeof e.type !== "string" || !VALID_DEBT_EDGE_TYPES.includes(e.type as DebtEdgeType)) return false;

  // If node IDs provided, verify they exist
  if (existingNodeIds && (!existingNodeIds.has(e.from) || !existingNodeIds.has(e.to))) {
    return false;
  }

  return true;
}

/** Validates a full TechDebtGraph (fail-closed). */
export function validateTechDebtGraph(graph: unknown): graph is TechDebtGraph {
  if (typeof graph !== "object" || graph === null) return false;
  const g = graph as Record<string, unknown>;

  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) return false;

  // Validate all nodes
  const nodeIds = new Set<string>();
  for (const node of g.nodes) {
    if (!validateTechDebtNode(node)) return false;
    if (nodeIds.has(node.id)) return false; // duplicate IDs
    nodeIds.add(node.id);
  }

  // Validate all edges
  const edgeKeys = new Set<string>();
  for (const edge of g.edges) {
    if (!validateTechDebtEdge(edge, nodeIds)) return false;
    const key = `${edge.from}|${edge.to}|${edge.type}`;
    if (edgeKeys.has(key)) return false; // duplicate edge
    edgeKeys.add(key);
  }

  return true;
}

/** Validates a TechDebtState (fail-closed). */
export function validateTechDebtState(state: unknown): state is TechDebtState {
  if (typeof state !== "object" || state === null) return false;
  const s = state as Record<string, unknown>;

  if (s.version !== 5) return false;
  if (!validateTechDebtGraph(s.techDebt)) return false;

  return true;
}

/** Creates a minimal valid TechDebtNode. */
export function createTechDebtNode(params: {
  id: string;
  title: string;
  description: string;
  location: string;
  severity: DebtSeverity;
  rootCause: string;
  paymentTrigger: string;
  author: string;
  affectedContracts?: string[];
  codeRefs?: string[];
  estimatedCost?: EstimatedCost;
  state?: DebtState;
}): TechDebtNode {
  const now = new Date().toISOString();
  const node: TechDebtNode = {
    id: params.id,
    title: params.title,
    description: params.description,
    location: params.location,
    severity: params.severity,
    rootCause: params.rootCause,
    paymentTrigger: params.paymentTrigger,
    author: params.author,
    affectedContracts: params.affectedContracts ?? [],
    codeRefs: params.codeRefs ?? [],
    estimatedCost: params.estimatedCost ?? { tokens: 0, calls: 0, wallTimeMs: 0 },
    state: params.state ?? "open",
    timestamp: now,
  };

  if (!validateTechDebtNode(node)) {
    throw new Error("Created TechDebtNode failed validation");
  }
  return node;
}

/** Creates a valid TechDebtEdge. */
export function createTechDebtEdge(params: {
  from: string;
  to: string;
  type: DebtEdgeType;
}): TechDebtEdge {
  const edge: TechDebtEdge = {
    from: params.from,
    to: params.to,
    type: params.type,
  };

  if (!validateTechDebtEdge(edge)) {
    throw new Error("Created TechDebtEdge failed validation");
  }
  return edge;
}

/** Migrates a v4 BlackboardState to v5 by adding empty techDebt graph. */
export function migrateBlackboardStateV4toV5(v4State: BlackboardStateV4): BlackboardStateV5 {
  // Fail-closed: must be a valid v4 state
  if (typeof v4State !== "object" || v4State === null) {
    throw new Error("Invalid v4 state: not an object");
  }
  if (v4State.version !== 4) {
    throw new Error(`Invalid v4 state version: expected 4, got ${v4State.version}`);
  }
  if (!Array.isArray(v4State.contracts)) {
    throw new Error("Invalid v4 state: contracts must be an array");
  }
  if (!Array.isArray(v4State.nodes)) {
    throw new Error("Invalid v4 state: nodes must be an array");
  }
  if (typeof v4State.lastFence !== "number") {
    throw new Error("Invalid v4 state: lastFence must be a number");
  }

  // Build v5 state with empty techDebt
  const v5: BlackboardStateV5 = {
    version: 5,
    contracts: v4State.contracts,
    lease: v4State.lease,
    nodes: v4State.nodes,
    lastFence: v4State.lastFence,
    usage: v4State.usage ?? {},
    decisions: v4State.decisions ?? { nodes: [], edges: [] },
    techDebt: { nodes: [], edges: [] },
  };

  return v5;
}

/** Creates an empty TechDebtGraph. */
export function createEmptyTechDebtGraph(): TechDebtGraph {
  return { nodes: [], edges: [] };
}

/** Adds a node to a TechDebtGraph (returns new graph, validates). */
export function addTechDebtNode(graph: TechDebtGraph, node: TechDebtNode): TechDebtGraph {
  if (!validateTechDebtNode(node)) {
    throw new Error("Invalid TechDebtNode");
  }
  if (graph.nodes.some((n) => n.id === node.id)) {
    throw new Error(`TechDebtNode with id ${node.id} already exists`);
  }
  return {
    nodes: [...graph.nodes, node],
    edges: [...graph.edges],
  };
}

/** Adds an edge to a TechDebtGraph (returns new graph, validates). */
export function addTechDebtEdge(graph: TechDebtGraph, edge: TechDebtEdge): TechDebtGraph {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  if (!validateTechDebtEdge(edge, nodeIds)) {
    throw new Error("Invalid TechDebtEdge or references non-existent nodes");
  }
  // Check for duplicate
  if (graph.edges.some((e) => e.from === edge.from && e.to === edge.to && e.type === edge.type)) {
    throw new Error("Duplicate TechDebtEdge");
  }
  return {
    nodes: [...graph.nodes],
    edges: [...graph.edges, edge],
  };
}

/** Gets the transitive subgraph reachable from a starting node (including the start node). */
export function getTechDebtSubgraph(graph: TechDebtGraph, startNodeId: string): TechDebtGraph {
  if (!graph.nodes.some((n) => n.id === startNodeId)) {
    throw new Error(`Start node ${startNodeId} not found in graph`);
  }

  const visited = new Set<string>();
  const relevantEdges: TechDebtEdge[] = [];

  const dfs = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    // Find outgoing edges
    for (const edge of graph.edges) {
      if (edge.from === nodeId) {
        relevantEdges.push(edge);
        dfs(edge.to);
      }
    }
  };

  dfs(startNodeId);

  const relevantNodes = graph.nodes.filter((n) => visited.has(n.id));

  return {
    nodes: relevantNodes,
    edges: relevantEdges,
  };
}

/** Finds all nodes that depend on (transitively) the given node. */
export function getTechDebtDependents(graph: TechDebtGraph, nodeId: string): TechDebtNode[] {
  if (!graph.nodes.some((n) => n.id === nodeId)) {
    throw new Error(`Node ${nodeId} not found in graph`);
  }

  const dependents = new Set<string>();
  const reverseEdges = new Map<string, string[]>();

  // Build reverse adjacency
  for (const edge of graph.edges) {
    if (!reverseEdges.has(edge.to)) reverseEdges.set(edge.to, []);
    reverseEdges.get(edge.to)!.push(edge.from);
  }

  const dfs = (id: string) => {
    const incoming = reverseEdges.get(id) ?? [];
    for (const from of incoming) {
      if (!dependents.has(from)) {
        dependents.add(from);
        dfs(from);
      }
    }
  };

  dfs(nodeId);

  return graph.nodes.filter((n) => dependents.has(n.id));
}

/** Checks if adding an edge would create a cycle. */
export function wouldCreateTechDebtCycle(graph: TechDebtGraph, newEdge: TechDebtEdge): boolean {
  // Temporarily add edge and check for cycle via DFS
  const testGraph = { ...graph, edges: [...graph.edges, newEdge] };
  const nodeIds = new Set(testGraph.nodes.map((n) => n.id));

  const visited = new Set<string>();
  const recStack = new Set<string>();

  const adj = new Map<string, string[]>();
  for (const edge of testGraph.edges) {
    if (!adj.has(edge.from)) adj.set(edge.from, []);
    adj.get(edge.from)!.push(edge.to);
  }

  const hasCycle = (nodeId: string): boolean => {
    if (recStack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;

    visited.add(nodeId);
    recStack.add(nodeId);

    const neighbors = adj.get(nodeId) ?? [];
    for (const neighbor of neighbors) {
      if (hasCycle(neighbor)) return true;
    }

    recStack.delete(nodeId);
    return false;
  };

  for (const nodeId of nodeIds) {
    if (!visited.has(nodeId)) {
      if (hasCycle(nodeId)) return true;
    }
  }

  return false;
}

/** Returns detailed validation errors for a TechDebtGraph (empty array = valid). */
export function getTechDebtGraphValidationErrors(graph: unknown): string[] {
  const errors: string[] = [];
  if (typeof graph !== "object" || graph === null) {
    errors.push("TechDebtGraph is not an object");
    return errors;
  }
  const g = graph as Record<string, unknown>;

  if (!Array.isArray(g.nodes)) {
    errors.push("nodes is not an array");
  } else {
    const nodeIds = new Set<string>();
    g.nodes.forEach((node: unknown, i: number) => {
      if (!validateTechDebtNode(node)) {
        errors.push(`node[${i}] failed validation`);
      } else {
        const n = node as TechDebtNode;
        if (nodeIds.has(n.id)) {
          errors.push(`duplicate node id: ${n.id}`);
        }
        nodeIds.add(n.id);
      }
    });
  }

  if (!Array.isArray(g.edges)) {
    errors.push("edges is not an array");
  } else {
    const edgeKeys = new Set<string>();
    const nodeIds = new Set((g.nodes as TechDebtNode[] ?? []).map((n) => n.id));
    g.edges.forEach((edge: unknown, i: number) => {
      if (!validateTechDebtEdge(edge, nodeIds)) {
        errors.push(`edge[${i}] failed validation or references non-existent nodes`);
      } else {
        const e = edge as TechDebtEdge;
        const key = `${e.from}|${e.to}|${e.type}`;
        if (edgeKeys.has(key)) {
          errors.push(`duplicate edge: ${key}`);
        }
        edgeKeys.add(key);
      }
    });
  }

  return errors;
}