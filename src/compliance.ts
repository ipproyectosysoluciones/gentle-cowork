/**
 * Phase 7 Slice 7.5 — Compliance Clause Types and Engine
 *
 * Types for compliance frameworks, clauses, controls, and reports.
 * Engine for running compliance checks against declared frameworks.
 */

import type { ValidationContext, ValidationResult, ValidationSuite } from "./validation-suites.ts";

/** Type of evidence for a compliance control. */
export type EvidenceType = "automated" | "documentary" | "mixed";

/** Status of a compliance control or clause. */
export type ComplianceStatus = "compliant" | "non-compliant" | "partial" | "not-assessed" | "error";

/** Evidence for a compliance control. */
export interface ComplianceEvidence {
  /** Whether the evidence comes from automated validation suite. */
  automated: boolean;
  /** ID of the validation suite that produced the evidence (if automated). */
  suiteId?: string;
  /** Result of the validation suite run (if automated). */
  result?: {
    passed: boolean;
    findings: Array<{ severity: string; message: string }>;
  };
  /** Document reference (if documentary evidence). */
  documentRef?: string;
  /** Human-readable description of the evidence. */
  description?: string;
  /** Status of the evidence. */
  status: ComplianceStatus;
  /** Timestamp when evidence was collected. */
  timestamp: string;
}

/** A compliance control - a specific requirement that can be verified. */
export interface ComplianceControl {
  /** Unique identifier for this control. */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Detailed description. */
  description: string;
  /** ID of the validation suite that verifies this control (if automated). */
  validationSuiteId?: string;
  /** Type of evidence for this control. */
  evidenceType: EvidenceType;
  /** Current status of this control. */
  status: ComplianceStatus;
  /** Evidence supporting the status. */
  evidence?: ComplianceEvidence;
  /** Timestamp of last assessment. */
  assessedAt?: string;
}

/** A compliance clause - a group of related controls. */
export interface ComplianceClause {
  /** Unique identifier for this clause (e.g., "A.5", "CC6.1", "art5"). */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Detailed description. */
  description: string;
  /** Controls that belong to this clause. */
  controls: ComplianceControl[];
  /** Overall status of this clause (derived from controls). */
  status: ComplianceStatus;
}

/** A compliance framework (e.g., ISO 27001, SOC 2, GDPR). */
export interface ComplianceFramework {
  /** Unique identifier (e.g., "iso27001", "soc2", "gdpr"). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Version of the framework. */
  version: string;
  /** Clauses in this framework. */
  clauses: ComplianceClause[];
}

/** Compliance report for a contract. */
export interface ComplianceReport {
  /** The contract this report is for. */
  contractId: string;
  /** Timestamp of the report. */
  timestamp: string;
  /** Results per framework. */
  frameworks: Array<{
    /** Framework ID. */
    frameworkId: string;
    /** Framework name. */
    frameworkName: string;
    /** Overall status for this framework. */
    status: ComplianceStatus;
    /** Results per clause. */
    clauses: Array<{
      /** Clause ID. */
      clauseId: string;
      /** Clause title. */
      clauseTitle: string;
      /** Status of this clause. */
      status: ComplianceStatus;
      /** Results per control. */
      controls: Array<{
        /** Control ID. */
        controlId: string;
        /** Control title. */
        controlTitle: string;
        /** Status of this control. */
        status: ComplianceStatus;
        /** Evidence for this control. */
        evidence?: ComplianceEvidence;
      }>;
    }>;
  }>;
  /** Overall compliance status across all frameworks. */
  overallStatus: ComplianceStatus;
  /** Identified gaps (non-compliant controls without remediation plan). */
  gaps: Array<{
    frameworkId: string;
    clauseId: string;
    controlId: string;
    description: string;
  }>;
}

/** Global registry of compliance frameworks. */
const frameworkRegistry = new Map<string, ComplianceFramework>();

/** Registers a compliance framework. Throws if already registered. */
export function registerFramework(framework: ComplianceFramework): void {
  if (frameworkRegistry.has(framework.id)) {
    throw new Error(`Compliance framework already registered: ${framework.id}`);
  }
  frameworkRegistry.set(framework.id, framework);
}

/** Retrieves a framework by ID. */
export function getFramework(id: string): ComplianceFramework | undefined {
  return frameworkRegistry.get(id);
}

/** Lists all registered framework IDs. */
export function listFrameworks(): string[] {
  return Array.from(frameworkRegistry.keys());
}

/**
 * Runs a compliance check for a contract.
 * Iterates declared frameworks, maps controls to validation suites and documentary evidence,
 * executes automated checks, and emits a ComplianceReport.
 */
/**
 * Computes the new clause status based on control status and current clause status.
 */
function computeClauseStatus(controlStatus: ComplianceStatus, clauseStatus: ComplianceStatus): ComplianceStatus {
  if (controlStatus === "non-compliant" || controlStatus === "error") return "non-compliant";
  if (controlStatus === "partial" && clauseStatus === "compliant") return "partial";
  if (controlStatus === "not-assessed" && clauseStatus === "compliant") return "partial";
  return clauseStatus;
}

/**
 * Computes the new framework status based on clause status and current framework status.
 */
function computeFrameworkStatus(clauseStatus: ComplianceStatus, frameworkStatus: ComplianceStatus): ComplianceStatus {
  if (clauseStatus === "non-compliant" || clauseStatus === "error") return "non-compliant";
  if (clauseStatus === "partial" && frameworkStatus === "compliant") return "partial";
  if (clauseStatus === "not-assessed" && frameworkStatus === "compliant") return "partial";
  return frameworkStatus;
}

/**
 * Updates clause status based on control status.
 */
function updateClauseStatus(controlStatus: ComplianceStatus, clauseStatus: ComplianceStatus): ComplianceStatus {
  if (controlStatus === "non-compliant" || controlStatus === "error") return "non-compliant";
  if (controlStatus === "partial" && clauseStatus === "compliant") return "partial";
  if (controlStatus === "not-assessed" && clauseStatus === "compliant") return "partial";
  return clauseStatus;
}

/**
 * Updates framework status based on clause status.
 */
function updateFrameworkStatus(clauseStatus: ComplianceStatus, frameworkStatus: ComplianceStatus): ComplianceStatus {
  if (clauseStatus === "non-compliant" || clauseStatus === "error") return "non-compliant";
  if (clauseStatus === "partial" && frameworkStatus === "compliant") return "partial";
  if (clauseStatus === "not-assessed" && frameworkStatus === "compliant") return "partial";
  return frameworkStatus;
}

export async function runComplianceCheck(
  contractId: string,
  blackboard: {
    getContract: (id: string) => { id: string; complianceFrameworks?: string[] } | undefined;
    getArchitecturalContext?: (contractId: string) => any;
    runValidationSuite?: (suiteId: string, context: any) => Promise<any>;
  }
): Promise<ComplianceReport> {
  const contract = blackboard.getContract(contractId);
  if (!contract) {
    throw new Error(`Contract not found: ${contractId}`);
  }

  const frameworks = contract.complianceFrameworks ?? [];
  const reportFrameworks: Array<{
    frameworkId: string;
    frameworkName: string;
    status: ComplianceStatus;
    clauses: Array<{
      clauseId: string;
      clauseTitle: string;
      status: ComplianceStatus;
      controls: Array<{
        controlId: string;
        controlTitle: string;
        status: ComplianceStatus;
        evidence?: ComplianceEvidence;
      }>;
    }>;
  }> = [];
  const allGaps: Array<{
    frameworkId: string;
    clauseId: string;
    controlId: string;
    description: string;
  }> = [];

  for (const frameworkId of frameworks) {
    const framework = getFramework(frameworkId);
    if (!framework) {
      // Framework not registered - record as gap
      allGaps.push({
        frameworkId,
        clauseId: "unknown",
        controlId: "unknown",
        description: `Framework ${frameworkId} not registered in compliance registry`,
      });
      continue;
    }

    const frameworkClauses: Array<{
      clauseId: string;
      clauseTitle: string;
      status: ComplianceStatus;
      controls: Array<{
        controlId: string;
        controlTitle: string;
        status: ComplianceStatus;
        evidence?: ComplianceEvidence;
      }>;
    }> = [];
    let frameworkStatus: ComplianceStatus = "compliant";

    for (const clause of framework.clauses) {
      const clauseControls: Array<{
        controlId: string;
        controlTitle: string;
        status: ComplianceStatus;
        evidence?: ComplianceEvidence;
      }> = [];
      let clauseStatus: ComplianceStatus = "compliant";

      for (const control of clause.controls) {
        let controlStatus: ComplianceStatus = "not-assessed";
        let evidence: ComplianceEvidence | undefined;

        // If control has a validation suite, run it
        if (control.validationSuiteId && blackboard.runValidationSuite) {
          try {
            const suiteResult = await blackboard.runValidationSuite(control.validationSuiteId, {});
            evidence = {
              automated: true,
              suiteId: control.validationSuiteId,
              result: {
                passed: suiteResult.passed,
                findings: suiteResult.findings?.map((f: any) => ({ severity: f.severity, message: f.message })) ?? [],
              },
              status: suiteResult.passed ? "compliant" : "non-compliant",
              timestamp: new Date().toISOString(),
            };
            controlStatus = suiteResult.passed ? "compliant" : "non-compliant";
          } catch (error) {
            // When validation suite is missing/unavailable, fall back to documentary evidence
            evidence = {
              automated: false,
              suiteId: control.validationSuiteId,
              status: "error",
              timestamp: new Date().toISOString(),
            };
            controlStatus = "error";
          }
        } else {
          // Documentary evidence - would be provided by human/process
          evidence = {
            automated: false,
            documentRef: `doc-${control.id}`,
            description: "Documentary evidence required",
            status: "not-assessed",
            timestamp: new Date().toISOString(),
          };
          controlStatus = "not-assessed";
        }

        clauseControls.push({
          controlId: control.id,
          controlTitle: control.title,
          status: controlStatus,
          evidence,
        });

        // Update clause status using a helper to avoid type narrowing
        clauseStatus = updateClauseStatus(controlStatus, clauseStatus);
      }

      // Update framework status using a helper
      frameworkStatus = updateFrameworkStatus(clauseStatus, frameworkStatus);

      frameworkClauses.push({
        clauseId: clause.id,
        clauseTitle: clause.title,
        status: clauseStatus,
        controls: clauseControls,
      });
    }

    // Record gaps for non-compliant controls
    for (const clause of framework.clauses) {
      for (const control of clause.controls) {
        // Find the status we computed for this control
        const computedControl = frameworkClauses.flatMap(c => c.controls).find(c => c.controlId === control.id);
        const computedStatus = computedControl?.status ?? "not-assessed";
        if (computedStatus === "non-compliant" || computedStatus === "error") {
          allGaps.push({
            frameworkId: framework.id,
            clauseId: clause.id,
            controlId: control.id,
            description: `Control ${control.id} (${control.title}) is ${computedStatus}`,
          });
        }
      }
    }

    reportFrameworks.push({
      frameworkId: framework.id,
      frameworkName: framework.name,
      status: frameworkStatus,
      clauses: frameworkClauses,
    });
  }

  return {
    contractId,
    timestamp: new Date().toISOString(),
    frameworks: reportFrameworks,
    overallStatus: allGaps.length === 0 ? "compliant" : (allGaps.length < frameworks.length ? "partial" : "non-compliant"),
    gaps: allGaps,
  };
}

/**
 * ISO/IEC 27001:2022 Framework
 * Annex A controls (A.5 - A.18)
 */
export const ISO27001_FRAMEWORK: ComplianceFramework = {
  id: "iso27001",
  name: "ISO/IEC 27001:2022",
  version: "2022",
  clauses: [
    { id: "A.5", title: "Information security policies", description: "Management direction for information security", status: "not-assessed", controls: [
        { id: "A.5.1", title: "Policies for information security", description: "A set of policies for information security shall be defined, approved by management, published and communicated to employees and relevant external parties.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
        { id: "A.5.2", title: "Review of the policies for information security", description: "The policies for information security shall be reviewed at planned intervals or if significant changes occur.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
        { id: "A.5.3", title: "Segregation of duties", description: "Conflicting duties and areas of responsibility shall be segregated.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
      ],
    },
    { id: "A.6", title: "Organization of information security", description: "Internal organization for information security", status: "not-assessed", controls: [
        { id: "A.6.1", title: "Internal organization", description: "All information security responsibilities shall be defined and allocated.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "A.6.2", title: "Segregation of duties", description: "Conflicting duties and areas of responsibility shall be segregated.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "A.6.3", title: "Contact with authorities", description: "Appropriate contacts with relevant authorities shall be maintained.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "A.6.4", title: "Contact with special interest groups", description: "Appropriate contacts with special interest groups shall be maintained.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "A.6.5", title: "Information security in project management", description: "Information security shall be addressed in project management.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "A.6.6", title: "Information security in supplier relationships", description: "Information security shall be addressed in supplier relationships.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "A.6.7", title: "Information security in supplier agreements", description: "Information security requirements shall be addressed in supplier agreements.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "A.6.8", title: "Information security in the ICT supply chain", description: "Information security requirements shall be addressed in the ICT supply chain.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
      ],
    },
    { id: "A.7", title: "Human resource security", description: "Security aspects of human resources", status: "not-assessed", controls: [
        { id: "A.7.1", title: "Screening", description: "Background verification checks on all candidates for employment.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "A.7.2", title: "Terms and conditions of employment", description: "The employment contracts shall state the employee's responsibilities for information security.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "A.7.3", title: "Information security awareness, education and training", description: "All employees and contractors shall receive appropriate awareness education and training.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "A.7.4", title: "Disciplinary process", description: "A formal disciplinary process shall be in place for security violations.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "A.7.5", title: "Termination or change of employment responsibilities", description: "Information security responsibilities and duties that remain valid after termination or change of employment shall be defined.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
      ],
    },
    { id: "A.8", title: "Asset management", description: "Responsibility for assets", status: "not-assessed", controls: [
        { id: "A.8.1", title: "Inventory of assets", description: "Assets associated with information and information processing facilities shall be identified and an inventory shall be drawn up and maintained.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "A.8.2", title: "Ownership of assets", description: "Assets shall be owned.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "A.8.3", title: "Acceptable use of assets", description: "Rules for the acceptable use of information and assets shall be identified, documented and implemented.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "A.8.4", title: "Return of assets", description: "All employees and contractors shall return all assets upon termination.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
      ],
    },
    { id: "A.9", title: "Access control", description: "Business requirements for access control", status: "not-assessed", controls: [
        { id: "A.9.1", title: "Access control policy", description: "An access control policy shall be established, documented and reviewed.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
        { id: "A.9.2", title: "User access management", description: "A formal user registration and de-registration process shall be implemented.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
        { id: "A.9.3", title: "User responsibilities", description: "Users shall be required to follow the organization's access control policy.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "A.9.4", title: "System and application access control", description: "Access to systems and applications shall be controlled.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
      ],
    },
    { id: "A.10", title: "Cryptography", description: "Cryptographic controls", status: "not-assessed", controls: [
        { id: "A.10.1", title: "Policy on the use of cryptographic controls", description: "A policy on the use of cryptographic controls shall be developed and implemented.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
        { id: "A.10.2", title: "Key management", description: "A policy on the use, protection and lifetime of cryptographic keys shall be developed and implemented.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
      ],
    },
    { id: "A.11", title: "Physical and environmental security", description: "Secure areas and equipment protection", status: "not-assessed", controls: [],
    },
    { id: "A.12", title: "Operations security", description: "Operational procedures and responsibilities", status: "not-assessed", controls: [],
    },
    { id: "A.13", title: "Communications security", description: "Network security management and information transfer", status: "not-assessed", controls: [],
    },
    { id: "A.14", title: "System acquisition, development and maintenance", description: "Security requirements of information systems", status: "not-assessed", controls: [],
    },
    { id: "A.15", title: "Supplier relationships", description: "Information security in supplier relationships", status: "not-assessed", controls: [],
    },
    { id: "A.16", title: "Information security incident management", description: "Management of information security incidents and improvements", status: "not-assessed", controls: [],
    },
    { id: "A.17", title: "Information security continuity", description: "Information security aspects of business continuity management", status: "not-assessed", controls: [],
    },
    { id: "A.18", title: "Compliance", description: "Compliance with legal and contractual requirements", status: "not-assessed", controls: [],
    },
  ],
};

/**
 * SOC 2 Type II Framework
 * Five Trust Service Criteria
 */
export const SOC2_FRAMEWORK: ComplianceFramework = {
  id: "soc2",
  name: "SOC 2 Type II",
  version: "2017",
  clauses: [
    { id: "CC", title: "Common Criteria / Security", description: "The system is protected against unauthorized access (both physical and logical).", status: "not-assessed", controls: [
        { id: "CC6.1", title: "Logical access security", description: "The entity implements logical access security software, infrastructure, and architectures.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
        { id: "CC6.2", title: "Credential management", description: "The entity implements credential management policies and procedures.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
        { id: "CC6.3", title: "Network segmentation", description: "The entity implements network segmentation to protect sensitive systems.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
        { id: "CC6.6", title: "Encryption of data at rest", description: "The entity encrypts data at rest.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
        { id: "CC6.7", title: "Encryption of data in transit", description: "The entity encrypts data in transit.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
        { id: "CC7.2", title: "System monitoring", description: "The entity monitors system components for anomalies.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
      ],
    },
    { id: "A", title: "Availability", description: "The system is available for operation and use as committed or agreed.", status: "not-assessed", controls: [
        { id: "A1.1", title: "System availability monitoring", description: "The entity monitors system availability.", validationSuiteId: "perf-thresholds", evidenceType: "automated", status: "not-assessed" },
        { id: "A1.2", title: "Disaster recovery", description: "The entity has a disaster recovery plan.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
      ],
    },
    { id: "PI", title: "Processing Integrity", description: "System processing is complete, valid, accurate, timely, and authorized.", status: "not-assessed", controls: [
        { id: "PI1.1", title: "Data processing accuracy", description: "The entity validates data processing accuracy.", validationSuiteId: "maintainability-metrics", evidenceType: "automated", status: "not-assessed" },
        { id: "PI1.2", title: "Error handling", description: "The entity handles processing errors appropriately.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
      ],
    },
    { id: "C", title: "Confidentiality", description: "Information designated as confidential is protected.", status: "not-assessed", controls: [
        { id: "C1.1", title: "Data classification", description: "The entity classifies data by sensitivity.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
        { id: "C1.2", title: "Confidential data disposal", description: "The entity properly disposes of confidential data.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
      ],
    },
    { id: "P", title: "Privacy", description: "Personal information is collected, used, retained, disclosed, and disposed of in conformity with the commitments in the entity's privacy notice.", status: "not-assessed", controls: [
        { id: "P1.1", title: "Privacy notice", description: "The entity provides a privacy notice.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "P1.2", title: "Data subject rights", description: "The entity facilitates data subject rights.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
      ],
    },
  ],
};

/**
 * EU GDPR Framework
 * Key articles
 */
export const GDPR_FRAMEWORK: ComplianceFramework = {
  id: "gdpr",
  name: "EU GDPR",
  version: "2016",
  clauses: [
    { id: "art5", title: "Principles relating to processing of personal data", description: "Lawfulness, fairness, transparency, purpose limitation, data minimisation, accuracy, storage limitation, integrity and confidentiality, accountability.", status: "not-assessed", controls: [
        { id: "art5.1.a", title: "Lawfulness, fairness, transparency", description: "Personal data processed lawfully, fairly, transparently.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
        { id: "art5.1.b", title: "Purpose limitation", description: "Collected for specified, explicit, legitimate purposes.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "art5.1.c", title: "Data minimisation", description: "Adequate, relevant, limited to what is necessary.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
        { id: "art5.1.d", title: "Accuracy", description: "Accurate and kept up to date.", validationSuiteId: "maintainability-metrics", evidenceType: "automated", status: "not-assessed" },
        { id: "art5.1.e", title: "Storage limitation", description: "Kept no longer than necessary.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
        { id: "art5.1.f", title: "Integrity and confidentiality", description: "Appropriate security of personal data.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
        { id: "art5.2", title: "Accountability", description: "Controller responsible for and able to demonstrate compliance.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
      ],
    },
    { id: "art6", title: "Lawfulness of processing", description: "Processing is lawful only if at least one basis applies.", status: "not-assessed", controls: [
        { id: "art6.1.a", title: "Consent", description: "Data subject has given consent.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "art6.1.b", title: "Contract", description: "Processing necessary for contract.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "art6.1.c", title: "Legal obligation", description: "Processing necessary for legal obligation.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "art6.1.f", title: "Legitimate interests", description: "Processing necessary for legitimate interests.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
      ],
    },
    { id: "art7", title: "Conditions for consent", description: "Consent must be freely given, specific, informed, unambiguous.", status: "not-assessed", controls: [
        { id: "art7.1", title: "Demonstrate consent", description: "Controller must demonstrate consent was given.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "art7.3", title: "Withdrawal of consent", description: "Data subject can withdraw consent at any time.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
      ],
    },
    { id: "art12", title: "Transparent information, communication and modalities for the exercise of the rights of the data subject", description: "Transparent information about processing.", status: "not-assessed", controls: [
        { id: "art12.1", title: "Concise, transparent, intelligible information", description: "Information provided in clear language.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "art12.3", title: "Facilitation of data subject rights", description: "Data subject can exercise rights easily.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
      ],
    },
    { id: "art25", title: "Data protection by design and by default", description: "Implement appropriate technical and organisational measures.", status: "not-assessed", controls: [
        { id: "art25.1", title: "Data protection by design", description: "Implement measures at design stage.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
        { id: "art25.2", title: "Data protection by default", description: "Only necessary data processed by default.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
      ],
    },
    { id: "art32", title: "Security of processing", description: "Appropriate technical and organisational measures.", status: "not-assessed", controls: [
        { id: "art32.1.a", title: "Pseudonymisation and encryption", description: "Implement pseudonymisation and encryption.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
        { id: "art32.1.b", title: "Confidentiality, integrity, availability, resilience", description: "Ensure ongoing confidentiality, integrity, availability, resilience.", validationSuiteId: "sast-basic", evidenceType: "automated", status: "not-assessed" },
        { id: "art32.1.c", title: "Ability to restore availability", description: "Restore availability and access in timely manner.", validationSuiteId: "perf-thresholds", evidenceType: "automated", status: "not-assessed" },
        { id: "art32.1.d", title: "Regular testing", description: "Regular testing of effectiveness of measures.", validationSuiteId: "maintainability-metrics", evidenceType: "automated", status: "not-assessed" },
      ],
    },
    { id: "art33", title: "Notification of a personal data breach to the supervisory authority", description: "Notify breach within 72 hours.", status: "not-assessed", controls: [
        { id: "art33.1", title: "72-hour notification", description: "Notify supervisory authority within 72 hours.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
        { id: "art33.3", title: "Breach documentation", description: "Document breaches and effects.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
      ],
    },
    { id: "art35", title: "Data protection impact assessment", description: "DPIA required for high-risk processing.", status: "not-assessed", controls: [
        { id: "art35.1", title: "DPIA for high-risk processing", description: "Carry out DPIA before processing.", validationSuiteId: "maintainability-metrics", evidenceType: "automated", status: "not-assessed" },
        { id: "art35.7", title: "Consult supervisory authority", description: "Consult if high risk cannot be mitigated.", validationSuiteId: undefined, evidenceType: "documentary", status: "not-assessed" },
      ],
    },
  ],
};

// Auto-register base frameworks
registerFramework(ISO27001_FRAMEWORK);
registerFramework(SOC2_FRAMEWORK);
registerFramework(GDPR_FRAMEWORK);