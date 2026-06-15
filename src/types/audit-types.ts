// ── Phase 10 — Enterprise Audit System ──────────────────────────────────
// Immutable, hash-chained audit log types, decision provenance tracking,
// and compliance report generation for SOC2 / ISO27001 / GDPR / HIPAA.

/**
 * All action types that can be recorded in the audit log.
 */
export type AuditActionType =
  | "agent_spawn"
  | "agent_output"
  | "agent_complete"
  | "agent_fail"
  | "delegation"
  | "approval"
  | "policy_eval"
  | "gate_pass"
  | "gate_reject"
  | "identity_action";

/**
 * A single entry in the immutable audit chain.
 * Each entry references the previous entry's hash, forming a hash chain.
 */
export interface AuditEntry {
  sequence: number;
  timestamp: string;
  eventId: string;
  agentDid: string;
  action: AuditActionType;
  inputHash: string;
  outputHash: string;
  inputRef: string;
  outputRef: string;
  signature: string;
  previousHash: string;
  entryHash: string;
}

/**
 * Optional filter for querying audit entries.
 */
export interface AuditFilter {
  agentDid?: string;
  action?: AuditActionType;
  fromSequence?: number;
  toSequence?: number;
  fromTimestamp?: string;
  toTimestamp?: string;
}

/**
 * Result of verifying the integrity of the audit chain.
 */
export interface ChainVerificationResult {
  valid: boolean;
  firstInvalid?: number;
  totalEntries?: number;
}

/**
 * Full provenance record for a single decision, tracing the path from
 * the original idea through every delegation step to final outputs.
 */
export interface DecisionProvenance {
  decisionId: string;
  idea: string;
  delegations: ProvenanceStep[];
  inputs: string[];
  outputs: string[];
  timeline: ProvenanceStep[];
}

/**
 * A single step in a provenance chain — one agent delegating to another,
 * producing output, or making a decision.
 */
export interface ProvenanceStep {
  timestamp: string;
  from: string;
  to?: string;
  action: string;
  inputSummary: string;
  outputSummary: string;
  signature: string;
}

/**
 * A compliance report for a given standard, covering a set of audit entries
 * and provenance records.
 */
export interface ComplianceReport {
  reportId: string;
  generatedAt: string;
  standard: "SOC2" | "ISO27001" | "GDPR" | "HIPAA";
  scope: string;
  entries: AuditEntry[];
  provenance: DecisionProvenance[];
  findings: ComplianceFinding[];
}

/**
 * A single compliance finding — a gap or violation detected during analysis.
 */
export interface ComplianceFinding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  description: string;
  evidence: string;
  remediation?: string;
}
