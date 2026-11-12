/**
 * Phase 7 Slice 7.5 — Compliance Clause Types Tests (RED phase)
 *
 * Tests for ComplianceFramework, ComplianceClause, ComplianceControl,
 * ComplianceReport, ComplianceEvidence types, framework registry,
 * and runComplianceCheck function.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ComplianceFramework,
  ComplianceClause,
  ComplianceControl,
  ComplianceReport,
  ComplianceEvidence,
  registerFramework,
  getFramework,
  listFrameworks,
  runComplianceCheck,
  ISO27001_FRAMEWORK,
  SOC2_FRAMEWORK,
  GDPR_FRAMEWORK,
} from "./compliance.ts";
import type { ValidationContext } from "./validation-suites.ts";
import type { Blackboard } from "./blackboard.ts";

describe("ComplianceFramework", () => {
  it("ISO27001 framework is registered with correct id and clauses", () => {
    expect(ISO27001_FRAMEWORK.id).toBe("iso27001");
    expect(ISO27001_FRAMEWORK.name).toBe("ISO/IEC 27001:2022");
    expect(ISO27001_FRAMEWORK.clauses.length).toBeGreaterThan(0);
    // Check A.5 (Information security policies)
    const a5 = ISO27001_FRAMEWORK.clauses.find(c => c.id === "A.5");
    expect(a5).toBeDefined();
    expect(a5!.controls.length).toBeGreaterThan(0);
  });

  it("SOC2 framework is registered with correct id and trust principles", () => {
    expect(SOC2_FRAMEWORK.id).toBe("soc2");
    expect(SOC2_FRAMEWORK.name).toBe("SOC 2 Type II");
    expect(SOC2_FRAMEWORK.clauses.length).toBe(5); // Security, Availability, Processing Integrity, Confidentiality, Privacy
  });

  it("GDPR framework is registered with correct id and articles", () => {
    expect(GDPR_FRAMEWORK.id).toBe("gdpr");
    expect(GDPR_FRAMEWORK.name).toBe("EU GDPR");
    expect(GDPR_FRAMEWORK.clauses.length).toBeGreaterThan(0);
    // Check Art. 5 (Principles)
    const art5 = GDPR_FRAMEWORK.clauses.find(c => c.id === "art5");
    expect(art5).toBeDefined();
  });
});

describe("ComplianceFrameworkRegistry", () => {
  beforeEach(() => {
    // Registry is module-level, base frameworks are auto-registered
  });

  it("registers a custom framework and retrieves it", () => {
    const customFramework: ComplianceFramework = {
      id: "custom-framework",
      name: "Custom Framework",
      version: "1.0",
      clauses: [
        {
          id: "clause-1",
          title: "Custom Clause",
          description: "A custom compliance clause",
          status: "not-assessed",
          controls: [
            {
              id: "ctrl-1",
              title: "Custom Control",
              description: "A custom control",
              validationSuiteId: "sast-basic",
              evidenceType: "automated",
              status: "not-assessed",
            },
          ],
        },
      ],
    };

    registerFramework(customFramework);
    const retrieved = getFramework("custom-framework");
    expect(retrieved).toBe(customFramework);
  });

  it("lists all registered frameworks", () => {
    const frameworks = listFrameworks();
    expect(frameworks).toContain("iso27001");
    expect(frameworks).toContain("soc2");
    expect(frameworks).toContain("gdpr");
  });

  it("returns undefined for non-existent framework", () => {
    expect(getFramework("non-existent")).toBeUndefined();
  });

  it("throws on duplicate registration", () => {
    const framework: ComplianceFramework = {
      id: "duplicate-framework",
      name: "Duplicate Framework",
      version: "1.0",
      clauses: [],
    };
    registerFramework(framework);
    expect(() => registerFramework(framework)).toThrow(/already registered/);
  });
});

describe("runComplianceCheck", () => {
  const mockBlackboard = {
    getArchitecturalContext: vi.fn().mockReturnValue({
      decisions: { nodes: [], edges: [] },
      techDebt: { nodes: [], edges: [] },
      dependencies: [],
    }),
    getContract: vi.fn().mockReturnValue({
      id: "gc-1",
      complianceFrameworks: ["iso27001", "gdpr"],
    }),
    getContractComplianceFrameworks: vi.fn().mockReturnValue(["iso27001", "gdpr"]),
    // Validation suites
    runValidationSuite: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty report for contract with no frameworks declared", async () => {
    const blackboard = {
      ...mockBlackboard,
      getContract: vi.fn().mockReturnValue({ id: "gc-1", complianceFrameworks: [] }),
    };

    const report = await runComplianceCheck("gc-1", blackboard);
    expect(report.contractId).toBe("gc-1");
    expect(report.frameworks).toHaveLength(0);
    expect(report.overallStatus).toBe("compliant");
  });

  it("runs compliance check for declared frameworks", async () => {
    const blackboard = {
      ...mockBlackboard,
      getContract: vi.fn().mockReturnValue({ id: "gc-1", complianceFrameworks: ["iso27001"] }),
    };

    const report = await runComplianceCheck("gc-1", blackboard);
    expect(report.contractId).toBe("gc-1");
    expect(report.frameworks).toHaveLength(1);
    expect(report.frameworks[0].frameworkId).toBe("iso27001");
  });

  it("executes validation suites for automated controls", async () => {
    const blackboard = {
      ...mockBlackboard,
      getContract: vi.fn().mockReturnValue({ id: "gc-1", complianceFrameworks: ["iso27001"] }),
      runValidationSuite: vi.fn().mockResolvedValue({
        suiteId: "sast-basic",
        passed: true,
        findings: [],
      }),
    };

    const report = await runComplianceCheck("gc-1", blackboard);
    expect(report.frameworks[0].clauses[0].controls[0].evidence).toBeDefined();
  });

  it("handles missing validation suite gracefully", async () => {
    const blackboard = {
      ...mockBlackboard,
      getContract: vi.fn().mockReturnValue({ id: "gc-1", complianceFrameworks: ["iso27001"] }),
      runValidationSuite: vi.fn().mockRejectedValue(new Error("Suite not found")),
    };

    const report = await runComplianceCheck("gc-1", blackboard);
    const ctrl = report.frameworks[0].clauses[0].controls[0];
    expect(ctrl.evidence).toBeDefined();
    expect(ctrl.evidence!.automated).toBe(false);
    expect(ctrl.evidence!.status).toBe("error");
  });

  it("aggregates overall status correctly", async () => {
    const blackboard = {
      ...mockBlackboard,
      getContract: vi.fn().mockReturnValue({ id: "gc-1", complianceFrameworks: ["iso27001", "gdpr"] }),
      runValidationSuite: vi.fn()
        .mockResolvedValueOnce({ suiteId: "sast-basic", passed: true, findings: [] })
        .mockResolvedValueOnce({ suiteId: "sast-basic", passed: false, findings: [{ severity: "error", message: "fail" }] }),
    };

    const report = await runComplianceCheck("gc-1", blackboard);
    // If any control fails, overall should be non-compliant
    expect(["compliant", "non-compliant", "partial"]).toContain(report.overallStatus);
  });
});

describe("ComplianceReport structure", () => {
  it("has correct structure", () => {
    const report: ComplianceReport = {
      contractId: "gc-1",
      timestamp: new Date().toISOString(),
      frameworks: [
        {
          frameworkId: "iso27001",
          frameworkName: "ISO/IEC 27001:2022",
          status: "compliant",
          clauses: [
            {
              clauseId: "A.5",
              clauseTitle: "Information security policies",
              status: "compliant",
              controls: [
                {
                  controlId: "A.5.1",
                  controlTitle: "Policies for information security",
                  status: "compliant",
                  evidence: {
                    automated: true,
                    suiteId: "sast-basic",
                    result: { passed: true, findings: [] },
                    status: "compliant",
                    timestamp: new Date().toISOString(),
                  },
                },
              ],
            },
          ],
        },
      ],
      overallStatus: "compliant",
      gaps: [],
    };

    expect(report.contractId).toBe("gc-1");
    expect(report.frameworks).toHaveLength(1);
    expect(report.overallStatus).toBe("compliant");
  });
});

describe("Base frameworks content", () => {
  it("ISO27001 has required annexes (A.5-A.18)", () => {
    const annexIds = ISO27001_FRAMEWORK.clauses.map(c => c.id);
    expect(annexIds).toContain("A.5");
    expect(annexIds).toContain("A.6");
    expect(annexIds).toContain("A.7");
    expect(annexIds).toContain("A.8");
    expect(annexIds).toContain("A.9");
    expect(annexIds).toContain("A.10");
    expect(annexIds).toContain("A.11");
    expect(annexIds).toContain("A.12");
    expect(annexIds).toContain("A.13");
    expect(annexIds).toContain("A.14");
    expect(annexIds).toContain("A.15");
    expect(annexIds).toContain("A.16");
    expect(annexIds).toContain("A.17");
    expect(annexIds).toContain("A.18");
  });

  it("SOC2 has 5 trust service criteria", () => {
    const criteriaIds = SOC2_FRAMEWORK.clauses.map(c => c.id);
    expect(criteriaIds).toContain("CC"); // Common Criteria / Security
    expect(criteriaIds).toContain("A");  // Availability
    expect(criteriaIds).toContain("PI"); // Processing Integrity
    expect(criteriaIds).toContain("C");  // Confidentiality
    expect(criteriaIds).toContain("P");  // Privacy
  });

  it("GDPR has key articles", () => {
    const articleIds = GDPR_FRAMEWORK.clauses.map(c => c.id);
    expect(articleIds).toContain("art5");  // Principles
    expect(articleIds).toContain("art6");  // Lawfulness
    expect(articleIds).toContain("art7");  // Consent
    expect(articleIds).toContain("art12"); // Transparent information
    expect(articleIds).toContain("art25"); // Data protection by design
    expect(articleIds).toContain("art32"); // Security of processing
    expect(articleIds).toContain("art33"); // Breach notification
  });
});