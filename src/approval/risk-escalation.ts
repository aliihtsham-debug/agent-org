/**
 * Phase 11 — Risk Escalation Engine
 */

import type { AgentResult } from "../types/agent-types.js";
import type { RiskLevel } from "../types/governance-types.js";
import type { EscalationRule, EscalationAction } from "../types/approval-types.js";
import { riskRank } from "../governance/risk-assessment.js";

export function evaluateEscalation(
  results: AgentResult[],
  riskLevel: RiskLevel,
  rules: EscalationRule[],
): EscalationAction | null {
  const failedCount = results.filter((r) => r.status === "failed").length;
  const criticalPathFailed = results.some(
    (r) => r.status === "failed" && ["cto", "pm", "ceo"].includes(r.role),
  );

  for (const rule of rules) {
    switch (rule.trigger) {
      case "risk_threshold":
        if (riskRank(riskLevel) >= 3) {
          // high or critical
          return {
            triggered: true,
            rule,
            reason: `Risk level "${riskLevel}" exceeds threshold`,
            target: rule.escalateTo,
          };
        }
        break;
      case "reject":
        if (criticalPathFailed) {
          return {
            triggered: true,
            rule,
            reason: "Critical-path agent failed",
            target: rule.escalateTo,
          };
        }
        break;
      case "manual":
        // Manual escalation is triggered externally
        break;
      case "timeout":
        // Timeout is checked externally via checkTimeout
        break;
    }
  }

  // Auto-escalate if more than 2 VPs failed
  if (failedCount > 2) {
    return {
      triggered: true,
      rule: {
        trigger: "reject",
        escalateTo: "ceo",
        notifyChannels: ["dashboard"],
        timeoutMs: 0,
      },
      reason: `${failedCount} agents failed — requires executive review`,
      target: "ceo",
    };
  }

  return null;
}

export async function escalate(
  requestId: string,
  target: string,
  reason: string,
): Promise<{ escalated: boolean; target: string; timestamp: string }> {
  return {
    escalated: true,
    target,
    timestamp: new Date().toISOString(),
  };
}
