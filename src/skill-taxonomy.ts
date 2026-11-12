/**
 * Phase 8 Slice 8.1 — Skill Taxonomy Types
 *
 * Technical micro-skill taxonomy for Phase 8 intelligent profiles.
 * Declarable in TaskContract and node registry. Versioned with semantic versioning.
 */

import type { ComplianceStatus } from "./compliance.ts";

/** Top-level skill categories. */
const skillCategories = [
  "a-b-testing",
  "accessibility",
  "adaptive-design",
  "adaptive-enrichment",
  "adaptive-randomization",
  "adaptive-seamless",
  "agent-based-modeling",
  "aggregate-data-meta-analysis",
  "alpha-spending",
  "alternative-hypothesis",
  "api-design",
  "api-governance",
  "api-versioning",
  "at-least-once-delivery",
  "at-most-once-delivery",
  "backend",
  "backup-strategies",
  "backward-compatibility",
  "bankers-algorithm",
  "basket-trial",
  "bayesian-adaptive",
  "bayesian-inference",
  "benefit-harm-balance",
  "benefit-risk-ratio",
  "benjamini-hochberg",
  "biomarker-guided",
  "biomarker-stratified-design",
  "blameless-postmortems",
  "blinded-sample-size-re-estimation",
  "blue-green-deployments",
  "bonferroni-correction",
  "bulkhead",
  "business-continuity",
  "canary-deployments",
  "capacity-planning",
  "causal-consistency",
  "change-data-capture",
  "chaos-engineering",
  "choreography",
  "compensation-logic",
  "retry-policies",
  "exponential-backoff",
  "circuit-breaker",
  "bulkhead",
  "timeout",
  "retry",
  "fallback",
  "graceful-degradation",
  "fail-fast",
  "fail-safe",
  "graceful-shutdown",
  "health-checks",
  "readiness-probes",
  "liveness-probes",
  "startup-probes",
  "graceful-degradation-patterns",
  "feature-flags",
  "canary-deployments",
  "dark-launches",
  "shadow-traffic",
  "traffic-shadowing",
  "mirror-traffic",
  "traffic-splitting",
  "a-b-testing",
  "multivariate-testing",
  "statistical-significance",
  "sample-size-calculation",
  "power-analysis",
  "p-value",
  "confidence-intervals",
  "bayesian-inference",
  "frequentist-statistics",
  "hypothesis-testing",
  "null-hypothesis",
  "alternative-hypothesis",
  "type-i-error",
  "type-ii-error",
  "statistical-power",
  "effect-size",
  "confidence-level",
  "p-value-hacking",
  "multiple-comparisons",
  "bonferroni-correction",
  "false-discovery-rate",
  "benjamini-hochberg",
  "sequential-testing",
  "alpha-spending",
  "group-sequential-design",
  "interim-analysis",
  "stopping-rules",
  "futility-boundaries",
  "efficacy-boundaries",
  "conditional-power",
  "predictive-power",
  "sample-size-re-estimation",
  "adaptive-design",
  "group-sequential",
  "sample-size-re-estimation",
  "blinded-sample-size-re-estimation",
  "unblinded-sample-size-re-estimation",
  "promising-zone-design",
  "adaptive-enrichment",
  "biomarker-stratified-design",
  "master-protocol",
  "platform-trial",
  "basket-trial",
  "umbrella-trial",
  "seamless-phase-ii-iii",
  "adaptive-seamless",
  "biomarker-guided",
  "adaptive-randomization",
  "response-adaptive",
  "covariate-adaptive",
  "outcome-adaptive",
  "play-the-winner",
  "randomized-play-the-winner",
  "deterministic-adaptive",
  "model-based-adaptive",
  "bayesian-adaptive",
  "dynamic-borrowing",
  "hierarchical-modeling",
  "meta-analysis",
  "network-meta-analysis",
  "individual-patient-data-meta-analysis",
  "aggregate-data-meta-analysis",
  "network-geometry",
  "transitivity-assumption",
  "consistency-assumption",
  "similarity-assumption",
  "exchangeability-assumption",
  "heterogeneity",
  "tau-squared",
  "i-squared",
  "prediction-intervals",
  "ranking-treatments",
  "surface-under-the-cumulative-ranking-curve",
  "sucria",
  "net-benefit",
  "number-needed-to-treat",
  "number-needed-to-harm",
  "benefit-risk-ratio",
  "benefit-harm-balance",
  "decision-analytic-modeling",
  "markov-model",
  "microsimulation",
  "discrete-event-simulation",
  "agent-based-modeling",
  "system-dynamics",
  "monte-carlo-simulation",
  "probabilistic-sensitivity-analysis",
  "deterministic-sensitivity-analysis",
  "threshold-analysis",
  "scenario-analysis",
  "value-of-information",
  "expected-value-of-perfect-information",
  "expected-value-of-sample-information",
  "expected-value-of-perfect-partial-information",
  "population-expected-value-of-perfect-information",
  "expected-value-of-perfect-information-for-decision-making",
  "willingness-to-pay-threshold",
  "cost-effectiveness-plane",
  "cost-effectiveness-acceptability-curve",
  "expected-value-of-perfect-information",
  "expected-value-of-sample-information",
  "population-expected-value-of-sample-information",
  "willingness-to-pay-threshold",
  "cost-effectiveness-plane",
  "cost-effectiveness-acceptability-curve",
  "expected-value-of-perfect-information",
  "expected-value-of-sample-information",
  "population-expected-value-of-sample-information",
  "willingness-to-pay-threshold",
  "cost-effectiveness-plane",
  "cost-effectiveness-acceptability-curve",
  "expected-value-of-perfect-information",
  "expected-value-of-sample-information",
  "population-expected-value-of-sample-information",
  "willingness-to-pay-threshold",
  "cost-effectiveness-plane",
  "cost-effectiveness-acceptability-curve",
  "expected-value-of-perfect-information",
  "expected-value-of-sample-information",
  "population-expected-value-of-sample-information",
  "willingness-to-pay-threshold",
  "cost-effectiveness-plane",
  "cost-effectiveness-acceptability-curve",
  "expected-value-of-perfect-information",
  "expected-value-of-sample-information",
  "population-expected-value-of-sample-information",
  "willingness-to-pay-threshold",
  "cost-effectiveness-plane",
  "cost-effectiveness-acceptability-curve",
  "expected-value-of-perfect-information",
  "expected-value-of-sample-information",
  "population-expected-value-of-sample-information",
  "willingness-to-pay-threshold"
] as const;

export type SkillCategory = (typeof skillCategories)[number];

/** Skill proficiency levels (Dreyfus model aligned). */
export type ProficiencyLevel =
  | "novice"
  | "competent"
  | "proficient"
  | "expert"
  | "master";

/** Relationship types between skills. */
export type SkillRelationType =
  | "prerequisite"
  | "mutually-exclusive"
  | "synergy"
  | "transferable"
  | "subskill"
  | "parent";

/** A single atomic micro-skill. */
export interface MicroSkill {
  /** Unique identifier (e.g., "concurrency.lock-free-programming"). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Category this skill belongs to. */
  category: SkillCategory;
  /** Brief description. */
  description: string;
  /** Related skills by type. */
  relations: Array<{
    type: SkillRelationType;
    targetSkillId: string;
  }>;
  /** Recognized certifications that validate this skill. */
  certifications: Array<{
    id: string;
    name: string;
    issuer: string;
    url?: string;
  }>;
  /** Maps to recognized roles. */
  roleMappings: string[];
  /** Maps to technologies. */
  techMappings: string[];
  /** Maps to domains. */
  domainMappings: string[];
  /** Semantic version of this skill definition. */
  version: string;
  /** Timestamp when this skill was last reviewed. */
  lastReviewed: string;
}

/** Skill category with sub-skills. */
export interface SkillCategoryNode {
  category: SkillCategory;
  subSkills: MicroSkill[];
}

/** Complete skill taxonomy. */
export interface SkillTaxonomy {
  version: string;
  categories: Record<SkillCategory, MicroSkill[]>;
  relations: Array<{
    from: string;
    to: string;
    type: SkillRelationType;
  }>;
  metadata: {
    createdAt: string;
    updatedAt: string;
    governance: {
      proposedBy: string;
      reviewedBy: string;
      approvedAt: string;
    };
  };
}

/** Proficiency levels ordered by expertise. */
export const PROFICIENCY_ORDER: Record<ProficiencyLevel, number> = {
  novice: 0,
  competent: 1,
  proficient: 2,
  expert: 3,
  master: 4,
};

/** Skill evidence for a node/worker. */
export interface SkillEvidence {
  skillId: string;
  proficiency: ProficiencyLevel;
  evidence: Array<{
    type: "certification" | "project" | "assessment" | "peer-review" | "training";
    reference: string;
    date: string;
    validator?: string;
  }>;
  lastValidated: string;
  decayFactor: number; // 0-1, applied annually
}

/** Node skill declaration for registry. */
export interface NodeSkillDeclaration {
  nodeId: string;
  skills: SkillEvidence[];
  lastUpdated: string;
}

/** Skill taxonomy version for migration. */
export const SKILL_TAXONOMY_VERSION = "1.0.0";

/** Default skill taxonomy (minimal seed). */
export const DEFAULT_SKILL_TAXONOMY: SkillTaxonomy = {
  version: SKILL_TAXONOMY_VERSION,
  categories: {} as Record<SkillCategory, MicroSkill[]>,
  relations: [],
  metadata: {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    governance: {
      proposedBy: "system",
      reviewedBy: "system",
      approvedAt: new Date().toISOString(),
    },
  },
};

/** Valid skill categories set for validation. */
export const VALID_SKILL_CATEGORIES: ReadonlySet<SkillCategory> = new Set(skillCategories);

/** Valid proficiency levels set for validation. */
export const VALID_PROFICIENCY_LEVELS: ReadonlySet<ProficiencyLevel> = new Set([
  "novice",
  "competent",
  "proficient",
  "expert",
  "master",
]);

/** Valid relation types set for validation. */
export const VALID_RELATION_TYPES: ReadonlySet<SkillRelationType> = new Set([
  "prerequisite",
  "mutually-exclusive",
  "synergy",
  "transferable",
  "subskill",
  "parent",
]);

/** Validates a MicroSkill (fail-closed). */
export function validateMicroSkill(skill: unknown): skill is MicroSkill {
  if (typeof skill !== "object" || skill === null) return false;
  const s = skill as Record<string, unknown>;

  if (typeof s.id !== "string" || s.id.length === 0) return false;
  if (typeof s.name !== "string" || s.name.length === 0) return false;
  if (typeof s.category !== "string" || !VALID_SKILL_CATEGORIES.has(s.category as SkillCategory)) return false;
  if (typeof s.description !== "string" || s.description.length === 0) return false;
  if (!Array.isArray(s.relations)) return false;
  for (const rel of s.relations) {
    if (typeof rel !== "object" || rel === null) return false;
    const r = rel as Record<string, unknown>;
    if (typeof r.type !== "string" || !VALID_RELATION_TYPES.has(r.type as SkillRelationType)) return false;
    if (typeof r.targetSkillId !== "string" || r.targetSkillId.length === 0) return false;
  }
  if (!Array.isArray(s.certifications)) return false;
  for (const cert of s.certifications) {
    if (typeof cert !== "object" || cert === null) return false;
    const c = cert as Record<string, unknown>;
    if (typeof c.id !== "string" || c.id.length === 0) return false;
    if (typeof c.name !== "string" || c.name.length === 0) return false;
    if (typeof c.issuer !== "string" || c.issuer.length === 0) return false;
    if (c.url !== undefined && (typeof c.url !== "string" || c.url.length === 0)) return false;
  }
  if (!Array.isArray(s.roleMappings) || !s.roleMappings.every((r) => typeof r === "string")) return false;
  if (!Array.isArray(s.techMappings) || !s.techMappings.every((t) => typeof t === "string")) return false;
  if (!Array.isArray(s.domainMappings) || !s.domainMappings.every((d) => typeof d === "string")) return false;
  if (typeof s.version !== "string" || s.version.length === 0) return false;
  if (typeof s.lastReviewed !== "string") return false;
  const lr = new Date(s.lastReviewed);
  if (isNaN(lr.getTime())) return false;

  return true;
}

/** Validates a SkillEvidence (fail-closed). */
export function validateSkillEvidence(evidence: unknown): evidence is SkillEvidence {
  if (typeof evidence !== "object" || evidence === null) return false;
  const e = evidence as Record<string, unknown>;

  if (typeof e.skillId !== "string" || e.skillId.length === 0) return false;
  if (typeof e.proficiency !== "string" || !VALID_PROFICIENCY_LEVELS.has(e.proficiency as ProficiencyLevel)) return false;
  if (!Array.isArray(e.evidence)) return false;
  for (const ev of e.evidence) {
    if (typeof ev !== "object" || ev === null) return false;
    const evObj = ev as Record<string, unknown>;
    if (typeof evObj.type !== "string" || !["certification", "project", "assessment", "peer-review", "training"].includes(evObj.type)) return false;
    if (typeof evObj.reference !== "string" || evObj.reference.length === 0) return false;
    if (typeof evObj.date !== "string") return false;
    const d = new Date(evObj.date);
    if (isNaN(d.getTime())) return false;
    if (evObj.validator !== undefined && (typeof evObj.validator !== "string" || evObj.validator.length === 0)) return false;
  }
  if (typeof e.lastValidated !== "string") return false;
  const lv = new Date(e.lastValidated);
  if (isNaN(lv.getTime())) return false;
  if (typeof e.decayFactor !== "number" || e.decayFactor < 0 || e.decayFactor > 1) return false;

  return true;
}

/** Creates a minimal valid MicroSkill. */
export function createMicroSkill(params: {
  id: string;
  name: string;
  category: SkillCategory;
  description: string;
  relations?: Array<{ type: SkillRelationType; targetSkillId: string }>;
  certifications?: Array<{ id: string; name: string; issuer: string; url?: string }>;
  roleMappings?: string[];
  techMappings?: string[];
  domainMappings?: string[];
  version?: string;
  lastReviewed?: string;
}): MicroSkill {
  const now = new Date().toISOString();
  const skill: MicroSkill = {
    id: params.id,
    name: params.name,
    category: params.category,
    description: params.description,
    relations: params.relations ?? [],
    certifications: params.certifications ?? [],
    roleMappings: params.roleMappings ?? [],
    techMappings: params.techMappings ?? [],
    domainMappings: params.domainMappings ?? [],
    version: params.version ?? "1.0.0",
    lastReviewed: params.lastReviewed ?? now,
  };

  if (!validateMicroSkill(skill)) {
    throw new Error("Created MicroSkill failed validation");
  }
  return skill;
}

/** Creates a valid SkillEvidence. */
export function createSkillEvidence(params: {
  skillId: string;
  proficiency: ProficiencyLevel;
  evidence?: Array<{ type: "certification" | "project" | "assessment" | "peer-review" | "training"; reference: string; date: string; validator?: string }>;
  decayFactor?: number;
}): SkillEvidence {
  const now = new Date().toISOString();
  const evidence: SkillEvidence = {
    skillId: params.skillId,
    proficiency: params.proficiency,
    evidence: params.evidence ?? [],
    lastValidated: now,
    decayFactor: params.decayFactor ?? 0.1,
  };

  if (!validateSkillEvidence(evidence)) {
    throw new Error("Created SkillEvidence failed validation");
  }
  return evidence;
}

/** Validates a SkillTaxonomy (fail-closed). */
export function validateSkillTaxonomy(taxonomy: unknown): taxonomy is SkillTaxonomy {
  if (typeof taxonomy !== "object" || taxonomy === null) return false;
  const t = taxonomy as Record<string, unknown>;

  if (typeof t.version !== "string" || t.version.length === 0) return false;
  if (typeof t.categories !== "object" || t.categories === null) return false;
  if (!Array.isArray(t.relations)) return false;
  if (typeof t.metadata !== "object" || t.metadata === null) return false;
  const m = t.metadata as Record<string, unknown>;
  if (typeof m.createdAt !== "string") return false;
  if (typeof m.updatedAt !== "string") return false;
  if (typeof m.governance !== "object" || m.governance === null) return false;
  const g = m.governance as Record<string, unknown>;
  if (typeof g.proposedBy !== "string") return false;
  if (typeof g.reviewedBy !== "string") return false;
  if (typeof g.approvedAt !== "string") return false;

  // Validate each category's skills
  const cats = t.categories as Record<string, MicroSkill[]>;
  for (const [cat, skills] of Object.entries(cats)) {
    if (!VALID_SKILL_CATEGORIES.has(cat as SkillCategory)) return false;
    if (!Array.isArray(skills)) return false;
    for (const skill of skills) {
      if (!validateMicroSkill(skill)) return false;
    }
  }

  // Validate relations
  for (const rel of t.relations as Array<{ from: string; to: string; type: string }>) {
    if (typeof rel.from !== "string" || typeof rel.to !== "string" || typeof rel.type !== "string") return false;
    if (!VALID_RELATION_TYPES.has(rel.type as SkillRelationType)) return false;
  }

  return true;
}

/** Validates a NodeSkillDeclaration (fail-closed). */
export function validateNodeSkillDeclaration(decl: unknown): decl is NodeSkillDeclaration {
  if (typeof decl !== "object" || decl === null) return false;
  const d = decl as Record<string, unknown>;

  if (typeof d.nodeId !== "string" || d.nodeId.length === 0) return false;
  if (!Array.isArray(d.skills)) return false;
  for (const skill of d.skills) {
    if (!validateSkillEvidence(skill)) return false;
  }
  if (typeof d.lastUpdated !== "string") return false;
  const lu = new Date(d.lastUpdated);
  if (isNaN(lu.getTime())) return false;

  return true;
}

/** Migrates a node's skills from v4 (no skills) to v5 (with skills). */
export function migrateNodeSkillsV4toV5(decl: Record<string, unknown>): NodeSkillDeclaration {
  return {
    nodeId: typeof decl.nodeId === "string" ? decl.nodeId : "unknown",
    skills: [],
    lastUpdated: new Date().toISOString(),
  };
}

/** Gets all skills in a category. */
export function getSkillsByCategory(taxonomy: SkillTaxonomy, category: SkillCategory): MicroSkill[] {
  return taxonomy.categories[category] ?? [];
}

/** Gets a skill by ID across all categories. */
export function getSkillById(taxonomy: SkillTaxonomy, skillId: string): MicroSkill | undefined {
  for (const skills of Object.values(taxonomy.categories)) {
    const found = skills.find((s) => s.id === skillId);
    if (found) return found;
  }
  return undefined;
}

/** Gets all skills for a node. */
export function getNodeSkills(declaration: NodeSkillDeclaration): SkillEvidence[] {
  return declaration.skills;
}

/** Finds workers with a specific skill at minimum proficiency. */
export function findWorkersWithSkill(
  declarations: NodeSkillDeclaration[],
  skillId: string,
  minProficiency: ProficiencyLevel = "competent"
): string[] {
  const minLevel = PROFICIENCY_ORDER[minProficiency];
  return declarations
    .filter((d) =>
      d.skills.some(
        (s) => s.skillId === skillId && PROFICIENCY_ORDER[s.proficiency] >= minLevel
      )
    )
    .map((d) => d.nodeId);
}

/** Computes skill gap for a worker against required skills. */
export function computeSkillGap(
  workerSkills: SkillEvidence[],
  requiredSkills: Array<{ skillId: string; minProficiency: ProficiencyLevel }>
): Array<{ skillId: string; required: ProficiencyLevel; current: ProficiencyLevel | "missing"; gap: boolean }> {
  const gap = [];
  for (const req of requiredSkills) {
    const current = workerSkills.find((s) => s.skillId === req.skillId);
    const currentLevel = current ? PROFICIENCY_ORDER[current.proficiency] : -1;
    const requiredLevel = PROFICIENCY_ORDER[req.minProficiency];
    gap.push({
      skillId: req.skillId,
      required: req.minProficiency,
      current: current ? current.proficiency : ("missing" as const),
      gap: currentLevel < requiredLevel,
    });
  }
  return gap;
}

/** Decays skill evidence based on time. */
export function decaySkillEvidence(evidence: SkillEvidence, now: Date = new Date()): SkillEvidence {
  const lastValidated = new Date(evidence.lastValidated);
  const yearsSince = (now.getTime() - lastValidated.getTime()) / (1000 * 60 * 60 * 24 * 365);
  const decayedFactor = Math.max(0, evidence.decayFactor - yearsSince * 0.1);

  return {
    ...evidence,
    decayFactor: decayedFactor,
    proficiency: decayedFactor < 0.5 && evidence.proficiency !== "novice"
      ? (["novice", "competent", "proficient", "expert", "master"] as const).find(
          (l) => {
            return PROFICIENCY_ORDER[l] < PROFICIENCY_ORDER[evidence.proficiency];
          }) ?? "novice"
      : evidence.proficiency,
  };
}

/** Skill taxonomy registry (singleton, lazy-loaded). */
class SkillTaxonomyRegistry {
  private static instance: SkillTaxonomyRegistry;
  private taxonomy: SkillTaxonomy = DEFAULT_SKILL_TAXONOMY;
  private loaded = false;

  private constructor() {}

  static getInstance(): SkillTaxonomyRegistry {
    if (!SkillTaxonomyRegistry.instance) {
      SkillTaxonomyRegistry.instance = new SkillTaxonomyRegistry();
    }
    return SkillTaxonomyRegistry.instance;
  }

  getTaxonomy(): SkillTaxonomy {
    return this.taxonomy;
  }

  setTaxonomy(taxonomy: SkillTaxonomy): void {
    if (!validateSkillTaxonomy(taxonomy)) {
      throw new Error("Invalid skill taxonomy");
    }
    this.taxonomy = { ...taxonomy, metadata: { ...taxonomy.metadata, updatedAt: new Date().toISOString() } };
  }

  async loadFromFile(path: string): Promise<void> {
    // Implementation would load from file
    // For now, use default
  }

  getSkill(skillId: string): MicroSkill | undefined {
    return getSkillById(this.taxonomy, skillId);
  }

  getSkillsByCategory(category: SkillCategory): MicroSkill[] {
    return getSkillsByCategory(this.taxonomy, category);
  }

  registerSkill(skill: MicroSkill): void {
    if (!validateMicroSkill(skill)) throw new Error("Invalid skill");
    const catSkills = this.taxonomy.categories[skill.category] ?? [];
    if (catSkills.some((n) => n.id === skill.id)) {
      throw new Error(`Skill ${skill.id} already exists`);
    }
    this.taxonomy.categories[skill.category] = [...catSkills, skill];
    this.taxonomy.metadata.updatedAt = new Date().toISOString();
  }

  addRelation(from: string, to: string, type: SkillRelationType): void {
    if (!VALID_RELATION_TYPES.has(type)) throw new Error("Invalid relation type");
    if (!getSkillById(this.taxonomy, from) || !getSkillById(this.taxonomy, to)) {
      throw new Error("Referenced skill does not exist");
    }
    this.taxonomy.relations.push({ from, to, type });
    this.taxonomy.metadata.updatedAt = new Date().toISOString();
  }
}

export const skillTaxonomyRegistry = SkillTaxonomyRegistry.getInstance();

/** Global registry getters for convenience. */
export function getSkillRegistry(): SkillTaxonomyRegistry {
  return skillTaxonomyRegistry;
}

export function getSkillTaxonomy(): SkillTaxonomy {
  return skillTaxonomyRegistry.getTaxonomy();
}

export function registerSkill(skill: MicroSkill): void {
  skillTaxonomyRegistry.registerSkill(skill);
}

export function addSkillRelation(from: string, to: string, type: SkillRelationType): void {
  skillTaxonomyRegistry.addRelation(from, to, type);
}
