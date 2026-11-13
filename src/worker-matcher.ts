/**
 * Phase 8 Slice 8.2 — Worker Matcher & Registry
 *
 * Worker matching by microskill × load × budget × affinity.
 * Integrates with SkillTaxonomy (8.1) and Blackboard (7.3 context injection).
 */

import {
  MicroSkill,
  ProficiencyLevel,
  SkillCategory,
  PROFICIENCY_ORDER,
  type SkillEvidence,
  validateSkillEvidence,
  createSkillEvidence,
  getSkillTaxonomy,
  getSkillById,
} from "./skill-taxonomy.ts";
import type { NodeRegistration } from "./blackboard.ts";

/** Required skill for a task with minimum proficiency and weight. */
export interface MicroSkillRequirement {
  /** Skill ID (must exist in SkillTaxonomy). */
  skillId: string;
  /** Minimum proficiency required. */
  minProficiency: "novice" | "competent" | "proficient" | "expert" | "master";
  /** Weight in matching score (0-1). */
  weight: number;
}

/** Result of worker matching. */
export interface WorkerMatchResult {
  /** Matched worker node ID, or null if no suitable worker. */
  matchedWorkerId: string | null;
  /** Match score (0-1). */
  score: number;
  /** Skills that matched. */
  matchedSkills: string[];
  /** Skills that failed to meet minimum proficiency. */
  missingSkills: string[];
  /** Reason if no match found. */
  reason?: string;
}

/** Cost estimation result. */
export interface CostEstimation {
  /** Estimated total tokens. */
  estimatedTokens: number;
  /** Estimated cost in currency units. */
  estimatedCost: number;
  /** Breakdown per skill. */
  breakdown: Array<{
    skillId: string;
    estimatedTokens: number;
    costPerToken: number;
    estimatedCost: number;
  }>;
  /** Worker ID used for estimation (or null if no match). */
  workerId: string | null;
}

/** Capacity check result. */
export interface CapacityCheckResult {
  /** Whether the worker has capacity. */
  hasCapacity: boolean;
  /** Reason if no capacity. */
  reason?: string;
}

/** Extended node registration with worker-specific fields. */
export interface WorkerRegistration extends NodeRegistration {
  /** Declared micro-skills with proficiency evidence. */
  skills: SkillEvidence[];
  /** Current load (0-100 scale). */
  currentLoad: number;
  /** Maximum capacity (0-100 scale). */
  capacity: number;
  /** Cost per token in currency units. */
  costPerToken: number;
  /** Current assigned tasks count. */
  assignedTasks: number;
}

/** Scoring weights for worker matching. */
export interface MatchingWeights {
  skills: number;      // 0.4 default
  load: number;        // 0.3 default
  budget: number;      // 0.2 default
  affinity: number;    // 0.1 default
}

/** Default matching weights. */
export const DEFAULT_MATCHING_WEIGHTS: MatchingWeights = {
  skills: 0.4,
  load: 0.3,
  budget: 0.2,
  affinity: 0.1,
};

/** Context for matching. */
export interface MatchContext {
  /** Domain affinity hint (e.g., "backend", "frontend", "security"). */
  domain?: string;
  /** Maximum acceptable cost. */
  maxCost?: number;
  /** Maximum acceptable tokens. */
  maxTokens?: number;
  /** Custom weights override. */
  weights?: Partial<MatchingWeights>;
}

/** Worker registry extending node registration with worker-specific fields. */
export class WorkerRegistry {
  private workers = new Map<string, WorkerRegistration>();

  /** Registers a worker with skills and capacity. */
  registerWorker(worker: WorkerRegistration): void {
    if (!worker.skills.every(validateSkillEvidence)) {
      throw new Error("Invalid skill evidence");
    }
    if (worker.capacity < 0 || worker.capacity > 100) {
      throw new Error("Capacity must be between 0 and 100");
    }
    if (worker.currentLoad < 0 || worker.currentLoad > worker.capacity) {
      throw new Error("Current load must be between 0 and capacity");
    }
    if (worker.costPerToken < 0) {
      throw new Error("Cost per token must be non-negative");
    }
    this.workers.set(worker.nodeId, worker);
  }

  /** Gets a worker by node ID. */
  getWorker(nodeId: string): WorkerRegistration | undefined {
    return this.workers.get(nodeId);
  }

  /** Updates worker's current load. */
  updateLoad(nodeId: string, load: number): void {
    const worker = this.workers.get(nodeId);
    if (!worker) throw new Error(`Worker not found: ${nodeId}`);
    if (load < 0 || load > worker.capacity) {
      throw new Error(`Load must be between 0 and capacity (${worker.capacity})`);
    }
    worker.currentLoad = load;
    worker.lastHeartbeat = new Date().toISOString();
  }

  /** Increments assigned tasks count. */
  incrementAssignedTasks(nodeId: string): void {
    const worker = this.workers.get(nodeId);
    if (worker) {
      worker.assignedTasks += 1;
      worker.lastHeartbeat = new Date().toISOString();
    }
  }

  /** Decrements assigned tasks count. */
  decrementAssignedTasks(nodeId: string): void {
    const worker = this.workers.get(nodeId);
    if (worker && worker.assignedTasks > 0) {
      worker.assignedTasks -= 1;
      worker.lastHeartbeat = new Date().toISOString();
    }
  }

  /** Gets a copy of the worker (defensive copy). */
  getWorkerCopy(nodeId: string): WorkerRegistration | undefined {
    const worker = this.workers.get(nodeId);
    if (!worker) return undefined;
    return { ...worker, skills: [...worker.skills] };
  }

  /** Lists all registered workers. */
  listWorkers(): WorkerRegistration[] {
    return Array.from(this.workers.values());
  }

  /** Gets worker by ID (alias for getWorker). */
  getWorkerById(nodeId: string): WorkerRegistration | undefined {
    return this.getWorker(nodeId);
  }
}

/** Worker matcher using skill, load, budget, and affinity scoring. */
export class WorkerMatcher {
  private registry: WorkerRegistry;
  private weights: MatchingWeights;

  constructor(registry: WorkerRegistry, weights: MatchingWeights = DEFAULT_MATCHING_WEIGHTS) {
    this.registry = registry;
    this.weights = weights;
  }

  /** Finds the best worker match for given requirements. */
  findBestMatch(
    requirements: MicroSkillRequirement[],
    context: MatchContext = {}
  ): WorkerMatchResult {
    const workers = this.registry.listWorkers();
    if (workers.length === 0) {
      return {
        matchedWorkerId: null,
        score: 0,
        matchedSkills: [],
        missingSkills: requirements.map((r) => r.skillId),
        reason: "No workers registered",
      };
    }

    let bestMatch: WorkerMatchResult | null = null;
    let bestScore = -1;

    for (const worker of this.registry.listWorkers()) {
      const result = this.scoreWorker(worker, requirements, context);
      if (result.score > bestScore) {
        bestScore = result.score;
        bestMatch = result;
      }
    }

    if (!bestMatch || bestMatch.matchedWorkerId === null) {
      return {
        matchedWorkerId: null,
        score: 0,
        matchedSkills: [],
        missingSkills: requirements.map((r) => r.skillId),
        reason: bestMatch?.reason || "No suitable worker found",
      };
    }

    return bestMatch;
  }

  /** Scores a single worker against requirements. */
  private scoreWorker(
    worker: WorkerRegistration,
    requirements: MicroSkillRequirement[],
    context: MatchContext
  ): WorkerMatchResult {
    const { skills, currentLoad, capacity, costPerToken } = worker;

    // 1. Skills score (40%)
    let skillsScore = 0;
    let matchedSkills: string[] = [];
    let missingSkills: string[] = [];

    for (const req of requirements) {
      const workerSkill = skills.find((s) => s.skillId === req.skillId);
      const minLevel = PROFICIENCY_ORDER[req.minProficiency];

      if (!workerSkill) {
        missingSkills.push(req.skillId);
        continue;
      }

      const workerLevel = PROFICIENCY_ORDER[workerSkill.proficiency];
      if (workerLevel < minLevel) {
        missingSkills.push(req.skillId);
        continue;
      }

      // Skill matches with sufficient proficiency
      matchedSkills.push(req.skillId);
      const proficiencyRatio = workerLevel / (PROFICIENCY_ORDER[req.minProficiency] || 1);
      skillsScore += req.weight * Math.min(proficiencyRatio, 1);
    }

    const skillsScoreNormalized = requirements.length > 0
      ? skillsScore / requirements.reduce((sum, r) => sum + r.weight, 0)
      : 0;

    // 2. Load score (30%) - lower load is better
    const loadRatio = worker.capacity > 0 ? 1 - worker.currentLoad / worker.capacity : 0;
    const loadScore = loadRatio;

    // 3. Budget score (20%) - lower cost is better
    let budgetScore = 1;
    if (context.maxCost && worker.costPerToken > 0) {
      // Estimate tokens for this task (simplified)
      const estimatedTokens = requirements.reduce((sum, r) => sum + r.weight * 1000, 0);
      const estimatedCost = estimatedTokens * worker.costPerToken;
      if (context.maxCost && context.maxCost > 0) {
        budgetScore = Math.max(0, 1 - estimatedCost / context.maxCost);
      }
    }

    // 4. Affinity score (10%)
    let affinityScore = 0;
    if (context.domain) {
      const domainSkills = this.getDomainSkills(context.domain);
      const workerDomainSkills = worker.skills.filter((s) => {
        const cat = this.getSkillCategory(s.skillId);
        return cat !== null && domainSkills.has(cat);
      }).length;
      const totalDomainSkills = domainSkills.size;
      affinityScore = totalDomainSkills > 0 ? workerDomainSkills / totalDomainSkills : 0;
    }

    // Weighted total score
    const totalScore =
      this.weights.skills * skillsScoreNormalized +
      this.weights.load * loadScore +
      this.weights.budget * budgetScore +
      this.weights.affinity * affinityScore;

    // Check if all required skills are met
    let reason = "Missing required skills";
    const allSkillsMet = requirements.every((req) => {
      const workerSkill = worker.skills.find((s) => s.skillId === req.skillId);
      if (!workerSkill) return false;
      if (PROFICIENCY_ORDER[workerSkill.proficiency] < PROFICIENCY_ORDER[req.minProficiency]) {
        reason = "Insufficient proficiency";
        return false;
      }
      return true;
    });

    if (!allSkillsMet) {
      const missingSkills = requirements
        .filter(
          (req) =>
            !worker.skills.some(
              (s) =>
                s.skillId === req.skillId &&
                PROFICIENCY_ORDER[s.proficiency] >= PROFICIENCY_ORDER[req.minProficiency]
            )
        )
        .map((r) => r.skillId);

      return {
        matchedWorkerId: null,
        score: 0,
        matchedSkills: [],
        missingSkills,
        reason,
      };
    }

    return {
      matchedWorkerId: worker.nodeId,
      score: totalScore,
      matchedSkills: requirements.map((r) => r.skillId),
      missingSkills: [],
    };
  }

  /** Gets skill categories relevant to a domain. */
  private getDomainSkills(domain: string): Set<SkillCategory> {
    const domainMap: Record<string, SkillCategory[]> = {
      backend: ["backend", "api-design", "api-governance", "api-versioning", "capacity-planning", "change-data-capture", "chaos-engineering", "choreography"],
      frontend: ["accessibility", "adaptive-design", "adaptive-enrichment", "adaptive-randomization", "adaptive-seamless"],
      security: ["circuit-breaker", "bulkhead", "retry-policies", "exponential-backoff", "timeout", "retry", "fallback", "graceful-degradation", "fail-fast", "fail-safe", "graceful-shutdown", "health-checks", "readiness-probes", "liveness-probes", "startup-probes"],
      devops: ["blue-green-deployments", "canary-deployments", "feature-flags", "dark-launches", "shadow-traffic", "traffic-shadowing", "mirror-traffic", "traffic-splitting", "a-b-testing", "multivariate-testing"],
      data: ["statistical-significance", "sample-size-calculation", "power-analysis", "p-value", "confidence-intervals", "bayesian-inference", "frequentist-statistics", "hypothesis-testing"],
      ai: ["alpha-spending", "group-sequential-design", "interim-analysis", "stopping-rules", "futility-boundaries", "efficacy-boundaries", "conditional-power", "predictive-power", "sample-size-re-estimation", "adaptive-design", "bayesian-adaptive", "biomarker-guided", "adaptive-enrichment", "biomarker-stratified-design", "master-protocol", "platform-trial", "basket-trial", "umbrella-trial", "seamless-phase-ii-iii", "adaptive-seamless", "adaptive-randomization", "bayesian-adaptive"],
    };
    return new Set(domainMap[domain] ?? []);
  }

  /** Gets the SkillCategory for a given skill ID by looking it up in the taxonomy. */
  private getSkillCategory(skillId: string): SkillCategory | null {
    const taxonomy = getSkillTaxonomy();
    const skill = getSkillById(taxonomy, skillId);
    return skill?.category ?? null; // No fallback - unknown skills don't match any domain
  }

  /** Estimates cost for requirements. */
  estimateCost(requirements: MicroSkillRequirement[], context: MatchContext = {}): CostEstimation {
    const result = this.findBestMatch(requirements, context);

    if (!result.matchedWorkerId) {
      return {
        estimatedTokens: 0,
        estimatedCost: 0,
        breakdown: [],
        workerId: null,
      };
    }

    const worker = this.registry.getWorker(result.matchedWorkerId!);
    if (!worker) {
      return {
        estimatedTokens: 0,
        estimatedCost: 0,
        breakdown: [],
        workerId: null,
      };
    }

    const breakdown = requirements.map((req) => {
      const estimatedTokens = Math.ceil(req.weight * 1000); // Simplified estimation
      return {
        skillId: req.skillId,
        estimatedTokens,
        costPerToken: worker.costPerToken,
        estimatedCost: estimatedTokens * worker.costPerToken,
      };
    });

    const estimatedTokens = breakdown.reduce((sum, b) => sum + b.estimatedTokens, 0);
    const estimatedCost = breakdown.reduce((sum, b) => sum + b.estimatedCost, 0);

    return {
      estimatedTokens,
      estimatedCost,
      breakdown,
      workerId: worker.nodeId,
    };
  }

  /** Checks if a worker has load capacity for given requirements. */
  checkCapacity(workerId: string, requirements: MicroSkillRequirement[]): CapacityCheckResult {
    const worker = this.registry.getWorker(workerId);
    if (!worker) {
      return { hasCapacity: false, reason: `Worker not found: ${workerId}` };
    }

    // Check basic load capacity
    if (worker.currentLoad >= worker.capacity) {
      return { hasCapacity: false, reason: "Worker at maximum capacity" };
    }

    return { hasCapacity: true };
  }
}

/** Creates a worker registration with validation. */
export function createWorkerRegistration(params: {
  nodeId: string;
  role: "master" | "worker";
  capabilities: ("planner" | "implementer" | "verifier")[];
  skills: Array<{ skillId: string; proficiency: "novice" | "competent" | "proficient" | "expert" | "master" }>;
  capacity?: number;
  costPerToken?: number;
}): WorkerRegistration {
  const skills = params.skills.map((s) =>
    createSkillEvidence({
      skillId: s.skillId,
      proficiency: s.proficiency,
      evidence: [],
      decayFactor: 0.1,
    })
  );

  const now = new Date().toISOString();
  return {
    nodeId: params.nodeId,
    role: params.role,
    capabilities: params.capabilities,
    skills,
    currentLoad: 0,
    capacity: params.capacity ?? 100,
    costPerToken: params.costPerToken ?? 0.001,
    assignedTasks: 0,
    startedAt: now,
    lastHeartbeat: now,
    status: "alive",
  };
}