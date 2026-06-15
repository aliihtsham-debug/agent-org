import type { AgentRole } from "../types/agent-types.js";

/**
 * Risk levels ordered from most to least severe.
 */
export type RiskLevel = "critical" | "high" | "medium" | "low" | "minimal";

/**
 * Policy effect: allow, deny, or require human approval before proceeding.
 */
export type PolicyEffect = "allow" | "deny" | "require_approval";

/**
 * A single policy rule that governs whether an agent can perform an action.
 */
export interface PolicyRule {
  id: string;
  name: string;
  description: string;
  effect: PolicyEffect;
  subjects: AgentRole[];
  actions: string[];
  resources?: string[];
  conditions?: PolicyCondition[];
  priority: number;
  createdAt: string;
}

/**
 * A condition that must be satisfied for a policy rule to apply.
 */
export interface PolicyCondition {
  type: "time_window" | "risk_threshold" | "delegation_depth" | "custom";
  params: Record<string, unknown>;
}

/**
 * Result of evaluating a policy rule against a subject and action.
 */
export interface PolicyDecision {
  allowed: boolean;
  effect: PolicyEffect;
  reason: string;
  ruleId: string;
  requiresApproval?: boolean;
}

/**
 * Context passed to the governance system for policy evaluation.
 */
export interface GovernanceContext {
  riskLevel: RiskLevel;
  delegationDepth: number;
  delegatorId?: string;
  resource?: string;
  timestamp: string;
}

/**
 * A pre-built governance template containing rules and an approval matrix.
 */
export interface GovernanceTemplate {
  name: string;
  description: string;
  rules: PolicyRule[];
  approvalMatrix: ApprovalMatrix;
}

/**
 * Approval matrix defining who must approve actions at each risk level.
 */
export interface ApprovalMatrix {
  critical: { approvers: AgentRole[]; minApprovals: number };
  high: { approvers: AgentRole[]; minApprovals: number };
  medium: { approvers: AgentRole[]; minApprovals: number };
  low: { approvers: AgentRole[]; minApprovals: number };
}

/**
 * A log entry recording a delegation event between agents.
 */
export interface DelegationLog {
  timestamp: string;
  from: AgentRole;
  to: AgentRole;
  action: "spawn" | "retry" | "complete" | "fail";
  summary: string;
}

/**
 * A chain of delegation logs representing the full delegation path.
 */
export interface DelegationChain {
  entries: DelegationLog[];
  depth: number;
  rootDelegator: AgentRole;
  leafAgent: AgentRole;
}

/**
 * Ordered risk levels for comparison.
 */
export const RISK_ORDER: Record<RiskLevel, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  minimal: 0,
};

/**
 * Compare two risk levels. Returns positive if a > b, negative if a < b, 0 if equal.
 */
export function compareRisk(a: RiskLevel, b: RiskLevel): number {
  return RISK_ORDER[a] - RISK_ORDER[b];
}

/**
 * Return the higher of two risk levels.
 */
export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}
