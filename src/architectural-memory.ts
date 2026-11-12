/**
 * Phase 7 Slice 7.1 — Architectural Memory Types
 *
 * Types for the decision graph persisted in the blackboard.
 * Fail-closed validation, v3→v4 migration.
 */

import type { BlackboardState } from "./blackboard.ts";
import type { ContractUsage } from "./metering.ts";

/** Valid decision states. */
export type DecisionStateValue = "proposed" | "accepted" | "rejected" | "superseded";

/** Valid edge types in the decision graph. */
export type DecisionEdgeType = "depends_on" | "supersedes" | "blocks" | "relates_to";

/** Shared constants for validation - single source of truth. */
export const VALID_DECISION_STATES: readonly DecisionStateValue[] = ["proposed", "accepted", "rejected", "superseded"] as const;
export const VALID_EDGE_TYPES: readonly DecisionEdgeType[] = ["depends_on", "supersedes", "blocks", "relates_to"] as const;

/** A node in the decision graph. */
export interface DecisionNode {
  /** Unique identifier (e.g., "dec-1", "dec-abc123"). */
  id: string;

  /** Human-readable title/summary. */
  title: string;

  /** Current state of the decision. */
  state: DecisionStateValue;

  /** Justification for the decision (required, non-empty). */
  justification: string;

  /** Contract IDs affected by this decision. */
  affectedContracts: string[];

  /** Code references: file:line or symbol paths. */
  codeRefs: string[];

  /** ISO timestamp when the decision was recorded. */
  timestamp: string;

  /** Author/identity who recorded the decision. */
  author: string;
}

/** A directed edge between two decision nodes. */
export interface DecisionEdge {
  /** Source decision node ID. */
  from: string;

  /** Target decision node ID. */
  to: string;

  /** Relationship type. */
  type: DecisionEdgeType;
}

/** The full decision graph (nodes + edges). */
export interface DecisionGraph {
  nodes: DecisionNode[];
  edges: DecisionEdge[];
}

/** Decision state embedded in the blackboard (v4+). */
export interface DecisionState {
  decisions: DecisionGraph;
  version: 4;
}

/** V3 blackboard state (before decisions field). */
export interface BlackboardStateV3 {
  version: 3;
  contracts: BlackboardState["contracts"];
  lease?: BlackboardState["lease"];
  nodes: BlackboardState["nodes"];
  lastFence: number;
  usage?: Record<string, ContractUsage>;
}

/** V4 blackboard state (with decisions field). */
export interface BlackboardStateV4 extends BlackboardState {
  version: 4;
  decisions: DecisionGraph;
}

/** Validates a DecisionNode (fail-closed). */
export function validateDecisionNode(node: unknown): node is DecisionNode {
  if (typeof node !== "object" || node === null) return false;
  const n = node as Record<string, unknown>;

  // Required string fields, non-empty
  if (typeof n.id !== "string" || n.id.length === 0) return false;
  if (typeof n.title !== "string" || n.title.length === 0) return false;
  if (typeof n.justification !== "string" || n.justification.length === 0) return false;
  if (typeof n.timestamp !== "string" || n.timestamp.length === 0) return false;
  if (typeof n.author !== "string" || n.author.length === 0) return false;

  // State must be one of the valid values
  if (typeof n.state !== "string" || !VALID_DECISION_STATES.includes(n.state as DecisionStateValue)) return false;

  // Arrays
  if (!Array.isArray(n.affectedContracts) || !n.affectedContracts.every((x) => typeof x === "string")) return false;
  if (!Array.isArray(n.codeRefs) || !n.codeRefs.every((x) => typeof x === "string")) return false;

  // Timestamp format validation (strict ISO 8601: YYYY-MM-DDTHH:mm:ss.sssZ)
  const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
  if (!iso8601Regex.test(n.timestamp)) return false;
  const ts = new Date(n.timestamp);
  if (isNaN(ts.getTime())) return false;

  return true;
}

/** Validates a DecisionEdge (fail-closed). */
export function validateDecisionEdge(edge: unknown, existingNodeIds?: ReadonlySet<string>): edge is DecisionEdge {
  if (typeof edge !== "object" || edge === null) return false;
  const e = edge as Record<string, unknown>;

  if (typeof e.from !== "string" || e.from.length === 0) return false;
  if (typeof e.to !== "string" || e.to.length === 0) return false;
  if (e.from === e.to) return false; // no self-loops

  if (typeof e.type !== "string" || !VALID_EDGE_TYPES.includes(e.type as DecisionEdgeType)) return false;

  // If node IDs provided, verify they exist
  if (existingNodeIds && (!existingNodeIds.has(e.from) || !existingNodeIds.has(e.to))) {
    return false;
  }

  return true;
}

/** Validates a full DecisionGraph (fail-closed). */
export function validateDecisionGraph(graph: unknown): graph is DecisionGraph {
  if (typeof graph !== "object" || graph === null) return false;
  const g = graph as Record<string, unknown>;

  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) return false;

  // Validate all nodes
  const nodeIds = new Set<string>();
  for (const node of g.nodes) {
    if (!validateDecisionNode(node)) return false;
    if (nodeIds.has(node.id)) return false; // duplicate IDs
    nodeIds.add(node.id);
  }

  // Validate all edges
  const edgeKeys = new Set<string>();
  for (const edge of g.edges) {
    if (!validateDecisionEdge(edge, nodeIds)) return false;
    const key = `${edge.from}|${edge.to}|${edge.type}`;
    if (edgeKeys.has(key)) return false; // duplicate edge
    edgeKeys.add(key);
  }

  return true;
}

/** Creates a minimal valid DecisionNode. */
export function createDecisionNode(params: {
  id: string;
  title: string;
  state: DecisionStateValue;
  justification: string;
  affectedContracts?: string[];
  codeRefs?: string[];
  timestamp?: string;
  author: string;
}): DecisionNode {
  const now = new Date().toISOString();
  const node: DecisionNode = {
    id: params.id,
    title: params.title,
    state: params.state,
    justification: params.justification,
    affectedContracts: params.affectedContracts ?? [],
    codeRefs: params.codeRefs ?? [],
    timestamp: params.timestamp ?? now,
    author: params.author,
  };

  if (!validateDecisionNode(node)) {
    throw new Error("Created DecisionNode failed validation");
  }
  return node;
}

/** Creates a valid DecisionEdge. */
export function createDecisionEdge(params: {
  from: string;
  to: string;
  type: DecisionEdgeType;
}): DecisionEdge {
  const edge: DecisionEdge = {
    from: params.from,
    to: params.to,
    type: params.type,
  };

  if (!validateDecisionEdge(edge)) {
    throw new Error("Created DecisionEdge failed validation");
  }
  return edge;
}

/** Migrates a v3 BlackboardState to v4 by adding empty decisions graph. */
export function migrateBlackboardStateV3toV4(v3State: BlackboardStateV3): BlackboardStateV4 {
  // Fail-closed: must be a valid v3 state
  if (typeof v3State !== "object" || v3State === null) {
    throw new Error("Invalid v3 state: not an object");
  }
  if (v3State.version !== 3) {
    throw new Error(`Invalid v3 state version: expected 3, got ${v3State.version}`);
  }
  if (!Array.isArray(v3State.contracts)) {
    throw new Error("Invalid v3 state: contracts must be an array");
  }
  if (!Array.isArray(v3State.nodes)) {
    throw new Error("Invalid v3 state: nodes must be an array");
  }
  if (typeof v3State.lastFence !== "number") {
    throw new Error("Invalid v3 state: lastFence must be a number");
  }

  // Build v4 state with empty decisions
  const v4: BlackboardStateV4 = {
    version: 4,
    contracts: v3State.contracts,
    lease: v3State.lease,
    nodes: v3State.nodes,
    lastFence: v3State.lastFence,
    usage: v3State.usage ?? {},
    decisions: { nodes: [], edges: [] },
  };

  return v4;
}

/** Validates a DecisionState (fail-closed). */
export function validateDecisionState(state: unknown): state is DecisionState {
  if (typeof state !== "object" || state === null) return false;
  const s = state as Record<string, unknown>;

  if (s.version !== 4) return false;
  if (!validateDecisionGraph(s.decisions)) return false;

  return true;
}

/** Creates an empty DecisionGraph. */
/** Returns detailed validation errors for a DecisionGraph (empty array = valid). */
export function getDecisionGraphValidationErrors(graph: unknown): string[] {
  const errors: string[] = [];
  if (typeof graph !== "object" || graph === null) {
    errors.push("DecisionGraph is not an object");
    return errors;
  }
  const g = graph as Record<string, unknown>;

  if (!Array.isArray(g.nodes)) {
    errors.push("nodes is not an array");
  } else {
    const nodeIds = new Set<string>();
    g.nodes.forEach((node: unknown, i: number) => {
      if (!validateDecisionNode(node)) {
        errors.push(`node[${i}] failed validation`);
      } else {
        const n = node as DecisionNode;
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
    const nodeIds = new Set((g.nodes as DecisionNode[] ?? []).map((n) => n.id));
    g.edges.forEach((edge: unknown, i: number) => {
      if (!validateDecisionEdge(edge, nodeIds)) {
        errors.push(`edge[${i}] failed validation or references non-existent nodes`);
      } else {
        const e = edge as DecisionEdge;
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

export function createEmptyDecisionGraph(): DecisionGraph {
  return { nodes: [], edges: [] };
}

/** Adds a node to a DecisionGraph (returns new graph, validates). */
export function addDecisionNode(graph: DecisionGraph, node: DecisionNode): DecisionGraph {
  if (!validateDecisionNode(node)) {
    throw new Error("Invalid DecisionNode");
  }
  if (graph.nodes.some((n) => n.id === node.id)) {
    throw new Error(`DecisionNode with id ${node.id} already exists`);
  }
  return {
    nodes: [...graph.nodes, node],
    edges: [...graph.edges],
  };
}

/** Adds an edge to a DecisionGraph (returns new graph, validates). */
export function addDecisionEdge(graph: DecisionGraph, edge: DecisionEdge): DecisionGraph {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  if (!validateDecisionEdge(edge, nodeIds)) {
    throw new Error("Invalid DecisionEdge or references non-existent nodes");
  }
  // Check for duplicate
  if (graph.edges.some((e) => e.from === edge.from && e.to === edge.to && e.type === edge.type)) {
    throw new Error("Duplicate DecisionEdge");
  }
  return {
    nodes: [...graph.nodes],
    edges: [...graph.edges, edge],
  };
}

/** Gets the transitive subgraph reachable from a starting node (including the start node). */
export function getDecisionSubgraph(graph: DecisionGraph, startNodeId: string): DecisionGraph {
  if (!graph.nodes.some((n) => n.id === startNodeId)) {
    throw new Error(`Start node ${startNodeId} not found in graph`);
  }

  const visited = new Set<string>();
  const relevantEdges: DecisionEdge[] = [];

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
export function getDependents(graph: DecisionGraph, nodeId: string): DecisionNode[] {
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
export function wouldCreateCycle(graph: DecisionGraph, newEdge: DecisionEdge): boolean {
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