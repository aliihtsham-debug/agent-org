// ── Phase 10 — Compliance Report Generation ──────────────────────────────
//
// Generates compliance-ready reports for SOC2, ISO27001, GDPR, HIPAA.
// Identifies gaps in audit trails and governance.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  AuditEntry,
  ComplianceReport,
  ComplianceFinding,
  DecisionProvenance,
} from "../types/audit-types.js";

function generateId(): string {
  try {
    return `rpt_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    return `rpt_${Date.now()}`;
  }
}

/**
 * Generate a compliance report for the given standard, covering the
 * provided audit entries and provenance records.
 */
export function generateReport(
  standard: ComplianceReport["standard"],
  entries: AuditEntry[],
  provenance: DecisionProvenance[],
): ComplianceReport {
  const findings = findGaps(entries, standard);

  return {
    reportId: generateId(),
    generatedAt: new Date().toISOString(),
    standard,
    scope: `Agent Org run — ${entries.length} audit entries, ${provenance.length} decision chains`,
    entries,
    provenance,
    findings,
  };
}

/**
 * Analyze audit entries against a compliance standard and return findings.
 * Checks:
 *   - All outputs are signed
 *   - All critical actions have approvals
 *   - Delegation chains are intact
 */
export function findGaps(
  entries: AuditEntry[],
  standard: ComplianceReport["standard"],
): ComplianceFinding[] {
  const findings: ComplianceFinding[] = [];

  // Check: all outputs signed
  const unsignedOutputs = entries.filter(
    (e) => e.action === "agent_output" && !e.signature,
  );
  if (unsignedOutputs.length > 0) {
    findings.push({
      severity: "high",
      description: `${unsignedOutputs.length} agent outputs are not cryptographically signed`,
      evidence: unsignedOutputs.map((e) => `entry:${e.sequence}`).join(", "),
      remediation: "Enable identity layer to sign all agent outputs",
    });
  }

  // Check: all critical actions approved
  const criticalActions = entries.filter(
    (e) => e.action === "gate_pass" || e.action === "gate_reject" || e.action === "approval",
  );
  const hasOutputsWithoutApproval = entries.some(
    (e) => e.action === "agent_output" && criticalActions.length === 0,
  );
  if (hasOutputsWithoutApproval && entries.some((e) => e.action === "agent_output")) {
    findings.push({
      severity: "medium",
      description: "No approval gates were recorded for agent outputs",
      evidence: entries.filter((e) => e.action === "agent_output").map((e) => `entry:${e.sequence}`).join(", "),
      remediation: "Enable approval gates for human-in-the-loop control",
    });
  }

  // Check: delegation chain integrity
  const delegationEntries = entries.filter((e) => e.action === "delegation");
  const spawnEntries = entries.filter((e) => e.action === "agent_spawn");
  if (spawnEntries.length > 0 && delegationEntries.length === 0) {
    findings.push({
      severity: "medium",
      description: "Agent spawns recorded without corresponding delegation entries",
      evidence: spawnEntries.map((e) => `entry:${e.sequence}`).join(", "),
      remediation: "Ensure all agent spawns are tracked in the delegation system",
    });
  }

  // Standard-specific checks
  switch (standard) {
    case "SOC2":
      if (entries.length === 0) {
        findings.push({
          severity: "critical",
          description: "No audit entries found — SOC2 requires comprehensive audit trails",
          evidence: "empty audit log",
          remediation: "Enable audit system for SOC2 compliance",
        });
      }
      break;
    case "ISO27001":
      if (!entries.some((e) => e.action === "policy_eval")) {
        findings.push({
          severity: "high",
          description: "No policy evaluation events found — ISO27001 requires documented access controls",
          evidence: "no policy_eval entries in audit log",
          remediation: "Enable governance framework for policy evaluation",
        });
      }
      break;
    case "GDPR":
      findings.push({
        severity: "info",
        description: "GDPR compliance requires data processing records — ensure agent outputs containing personal data are identified",
        evidence: "review required",
        remediation: "Review agent outputs for personal data and document processing purposes",
      });
      break;
    case "HIPAA":
      findings.push({
        severity: "info",
        description: "HIPAA compliance requires PHI access controls — ensure agents handling health data are properly authorized",
        evidence: "review required",
        remediation: "Implement role-based access controls for agents processing health information",
      });
      break;
  }

  return findings;
}

/**
 * Export a compliance report to a JSON file.
 */
export async function exportReport(report: ComplianceReport, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2));
}
