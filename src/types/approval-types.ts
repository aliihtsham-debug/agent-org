/**
 * Phase 11 — Human-in-the-Loop Enterprise Control
 *
 * Multi-stage approval workflows, risk escalation, human override.
 */

import type { RiskLevel } from "./governance-types.js";

export type ApprovalDecision = "approve" | "approve_with_conditions" | "reject" | "escalate" | "defer";
export type ApprovalStage = "draft" | "pending" | "approved" | "rejected" | "escalated" | "overridden";

export interface ApprovalRequest {
  id: string;
  stageId: string;
  title: string;
  description: string;
  requestedBy: string;
  requestedAt: string;
  riskLevel: RiskLevel;
  context: ApprovalContext;
  options: ApprovalOption[];
  timeoutMs: number;
  escalationTarget?: string;
}

export interface ApprovalContext {
  agentOutputs: string[];
  summary: string;
  riskAssessment: string;
}

export interface ApprovalOption {
  decision: ApprovalDecision;
  label: string;
  requiresComment: boolean;
  conditions?: string[];
}

export interface ApprovalResponse {
  requestId: string;
  decision: ApprovalDecision;
  decidedBy: string;
  decidedAt: string;
  comment?: string;
  conditions?: string[];
}

export interface EscalationRule {
  trigger: "timeout" | "reject" | "risk_threshold" | "manual";
  escalateTo: string;
  notifyChannels: string[];
  timeoutMs: number;
}

export interface EscalationAction {
  triggered: boolean;
  rule: EscalationRule;
  reason: string;
  target: string;
}

export interface MultiStageApproval {
  stages: ApprovalStageConfig[];
  currentStage: number;
  status: ApprovalStage;
}

export interface ApprovalStageConfig {
  name: string;
  approvers: string[];
  minApprovals: number;
  timeoutMs: number;
}
