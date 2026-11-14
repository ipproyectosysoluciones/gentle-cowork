/**
 * Phase 8 Slice 8.2 — Worker Matcher Tests (RED phase)
 *
 * Tests for WorkerMatcher, WorkerRegistry, and integration with blackboard.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  WorkerMatcher,
  WorkerRegistry,
  type WorkerMatchResult,
} from "./worker-matcher.ts";
import type { MicroSkill, ProficiencyLevel, SkillCategory, MicroSkillRequirement } from "./skill-taxonomy.ts";
import { createSkillEvidence } from "./skill-taxonomy.ts";
import type { NodeRegistration } from "./blackboard.ts";

// Test helpers
function createMockSkill(
  id: string,
  category: SkillCategory = "backend",
  proficiency: "proficient" = "proficient"
): MicroSkill {
  return {
    id,
    name: `Test ${id}`,
    category,
    description: `Test skill ${id}`,
    relations: [],
    certifications: [],
    roleMappings: ["worker"],
    techMappings: [],
    domainMappings: [],
    version: "1.0.0",
    lastReviewed: new Date().toISOString(),
  };
}

function createWorkerWithSkills(
  nodeId: string,
  skills: Array<{ skillId: string; proficiency: "novice" | "competent" | "proficient" | "expert" | "master" }>,
  capacity = 100,
  currentLoad = 0,
  costPerToken = 0.001
) {
  const skillEvidences = skills.map((s) =>
    createSkillEvidence({
      skillId: s.skillId,
      proficiency: s.proficiency,
      evidence: [],
      decayFactor: 0.1,
    })
  );
  return {
    nodeId,
    role: "worker" as const,
    capabilities: ["implementer" as const],
    skills: skillEvidences,
    startedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
    status: "alive" as const,
    capacity,
    currentLoad,
    costPerToken,
    assignedTasks: 0,
  };
}

describe("WorkerRegistry", () => {
  let registry: WorkerRegistry;

  beforeEach(() => {
    registry = new WorkerRegistry();
  });

  it("registers a worker with skills", () => {
    const worker = createWorkerWithSkills("worker-1", [
      { skillId: "backend.api-design", proficiency: "expert" },
      { skillId: "backend.database-design", proficiency: "proficient" },
    ]);
    registry.registerWorker(worker);

    const retrieved = registry.getWorker("worker-1");
    expect(retrieved).toBeDefined();
    expect(retrieved?.nodeId).toBe("worker-1");
    expect(retrieved?.skills).toHaveLength(2);
  });

  it("updates worker load", () => {
    const worker = createWorkerWithSkills("worker-2", [{ skillId: "backend.testing", proficiency: "proficient" }]);
    registry.registerWorker(worker);
    registry.updateLoad("worker-2", 50);

    const retrieved = registry.getWorker("worker-2");
    expect(retrieved?.currentLoad).toBe(50);
  });

  it("returns undefined for non-existent worker", () => {
    expect(registry.getWorker("non-existent")).toBeUndefined();
  });

  it("lists all workers", () => {
    registry.registerWorker(createWorkerWithSkills("worker-a", []));
    registry.registerWorker(createWorkerWithSkills("worker-b", []));
    expect(registry.listWorkers()).toHaveLength(2);
  });
});

describe("WorkerMatcher", () => {
  let matcher: WorkerMatcher;
  let registry: WorkerRegistry;

  beforeEach(() => {
    registry = new WorkerRegistry();
    matcher = new WorkerMatcher(registry);
  });

  it("finds best match for required skills", () => {
    // Register workers with different skill sets
    registry.registerWorker(
      createWorkerWithSkills("worker-expert", [
        { skillId: "backend.api-design", proficiency: "expert" },
        { skillId: "backend.database-design", proficiency: "expert" },
      ])
    );
    registry.registerWorker(
      createWorkerWithSkills("worker-proficient", [
        { skillId: "backend.api-design", proficiency: "proficient" },
      ])
    );
    registry.registerWorker(
      createWorkerWithSkills("worker-novice", [
        { skillId: "frontend.react", proficiency: "novice" },
      ])
    );

    const requirements: MicroSkillRequirement[] = [
      { skillId: "backend.api-design", minProficiency: "proficient", weight: 1.0 },
      { skillId: "backend.database-design", minProficiency: "proficient", weight: 0.5 },
    ];

    const result = matcher.findBestMatch(requirements, {});

    expect(result.matchedWorkerId).toBe("worker-expert");
    expect(result.score).toBeGreaterThan(0.7);
    expect(result.matchedSkills).toContain("backend.api-design");
    expect(result.matchedSkills).toContain("backend.database-design");
  });

  it("returns null when no worker meets minimum proficiency", () => {
    registry.registerWorker(
      createWorkerWithSkills("worker-novice", [
        { skillId: "backend.api-design", proficiency: "novice" },
      ])
    );

    const requirements: MicroSkillRequirement[] = [
      { skillId: "backend.api-design", minProficiency: "expert", weight: 1.0 },
    ];

    const result = matcher.findBestMatch(requirements, {});
    expect(result.matchedWorkerId).toBeNull();
    expect(result.reason).toContain("proficiency");
  });

  it("considers current load in scoring", () => {
    registry.registerWorker(
      createWorkerWithSkills("worker-free", [
        { skillId: "backend.api-design", proficiency: "expert" },
      ], 100, 0) // capacity 100, load 0
    );
    registry.registerWorker(
      createWorkerWithSkills("worker-busy", [
        { skillId: "backend.api-design", proficiency: "expert" },
      ], 100, 90) // capacity 100, load 90
    );

    const requirements: MicroSkillRequirement[] = [
      { skillId: "backend.api-design", minProficiency: "expert", weight: 1.0 },
    ];

    const result = matcher.findBestMatch(requirements, {});
    expect(result.matchedWorkerId).toBe("worker-free");
  });

  it("considers cost per token in scoring", () => {
    registry.registerWorker(
      createWorkerWithSkills("worker-cheap", [
        { skillId: "backend.api-design", proficiency: "expert" },
      ], 100, 0, 0.0005)
    );
    registry.registerWorker(
      createWorkerWithSkills("worker-expensive", [
        { skillId: "backend.api-design", proficiency: "expert" },
      ], 100, 0, 0.01)
    );

    const requirements: MicroSkillRequirement[] = [
      { skillId: "backend.api-design", minProficiency: "expert", weight: 1.0 },
    ];

    const result = matcher.findBestMatch(requirements, {});
    expect(result.matchedWorkerId).toBe("worker-cheap");
  });

  it("considers domain affinity in scoring", () => {
    registry.registerWorker(
      createWorkerWithSkills("worker-backend", [
        { skillId: "backend.api-design", proficiency: "expert" },
      ], 100, 0)
    );
    registry.registerWorker(
      createWorkerWithSkills("worker-fullstack", [
        { skillId: "backend.api-design", proficiency: "expert" },
        { skillId: "frontend.react", proficiency: "expert" },
      ], 100, 0)
    );

    const requirements: MicroSkillRequirement[] = [
      { skillId: "backend.api-design", minProficiency: "expert", weight: 1.0 },
    ];

    const context = { domain: "backend" };
    const result = matcher.findBestMatch(requirements, context);
    expect(result.matchedWorkerId).toBe("worker-backend");
  });
});

describe("WorkerMatcher - cost estimation", () => {
  let matcher: WorkerMatcher;
  let registry: WorkerRegistry;

  beforeEach(() => {
    registry = new WorkerRegistry();
    matcher = new WorkerMatcher(registry);
  });

  it("estimates cost based on skill weights and worker cost per token", () => {
    registry.registerWorker(
      createWorkerWithSkills("worker-1", [
        { skillId: "backend.api-design", proficiency: "expert" },
      ], 100, 0, 0.001)
    );

    const requirements: MicroSkillRequirement[] = [
      { skillId: "backend.api-design", minProficiency: "expert", weight: 1.0 },
    ];

    const cost = matcher.estimateCost(requirements, {});
    expect(cost.estimatedTokens).toBeGreaterThan(0);
    expect(cost.estimatedCost).toBeGreaterThan(0);
    expect(cost.breakdown).toHaveLength(1);
  });

  it("returns zero cost when no worker matches", () => {
    const requirements: MicroSkillRequirement[] = [
      { skillId: "nonexistent.skill", minProficiency: "expert", weight: 1.0 },
    ];

    const cost = matcher.estimateCost(requirements, {});
    expect(cost.estimatedCost).toBe(0);
    expect(cost.estimatedTokens).toBe(0);
  });
});

describe("WorkerMatcher - capacity check", () => {
  let matcher: WorkerMatcher;
  let registry: WorkerRegistry;

  beforeEach(() => {
    registry = new WorkerRegistry();
    matcher = new WorkerMatcher(registry);
  });

  it("returns true when worker has capacity", () => {
    registry.registerWorker(
      createWorkerWithSkills("worker-1", [], 100, 50)
    );

    const result = matcher.checkCapacity("worker-1", [{ skillId: "backend.api-design", minProficiency: "proficient", weight: 1.0 }]);
    expect(result.hasCapacity).toBe(true);
  });

  it("returns false when worker at capacity", () => {
    registry.registerWorker(
      createWorkerWithSkills("worker-full", [], 100, 100)
    );

    const result = matcher.checkCapacity("worker-full", []);
    expect(result.hasCapacity).toBe(false);
    expect(result.reason).toContain("capacity");
  });

  it("returns false for non-existent worker", () => {
    const result = matcher.checkCapacity("non-existent", []);
    expect(result.hasCapacity).toBe(false);
    expect(result.reason).toContain("not found");
  });
});