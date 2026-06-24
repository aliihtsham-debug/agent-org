// ── Governance Editor ─────────────────────────────────────────────────
// Single-level tuning on PolicyRule conditions and ApprovalMatrix.minApprovals.
//
// Safety model:
//   - Only adjusts one level per proposal (e.g., risk_threshold from "high" → "medium").
//   - Never adds new PolicyRule objects (only tunes existing ones).
//   - Never removes existing conditions.
//   - Requires --auto or explicit human approval to apply.

import type { ProposedChange } from "../types/meta-types.js";
import type { PolicyRule, ApprovalMatrix, RiskLevel } from "../types/governance-types.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Apply a governance tuning proposal to the target file.
 *
 * Supports two strategies:
 * - "policy-rule": adjust a condition level on a specific PolicyRule
 * - "approval-matrix": adjust minApprovals for a risk level
 */
export async function applyGovernanceEdit(
  proposal: ProposedChange,
  projectRoot: string,
): Promise<{ success: boolean; newContent?: string; error?: string }> {
  const filePath = join(projectRoot, proposal.sourceFile);

  try {
    const currentContent = await readFile(filePath, "utf-8");
    const patch = JSON.parse(proposal.patch) as {
      strategy?: "policy-rule" | "approval-matrix";
      ruleId?: string;
      conditionType?: string;
      fromLevel?: string;
      toLevel?: string;
      riskLevel?: RiskLevel;
      fromApprovals?: number;
      toApprovals?: number;
    };

    if (patch.strategy === "policy-rule" && patch.ruleId && patch.conditionType && patch.fromLevel && patch.toLevel) {
      return applyPolicyRuleTuning(currentContent, patch.ruleId, patch.conditionType, patch.fromLevel, patch.toLevel);
    }

    if (patch.strategy === "approval-matrix" && patch.riskLevel && patch.fromApprovals !== undefined && patch.toApprovals !== undefined) {
      return applyApprovalMatrixTuning(currentContent, patch.riskLevel, patch.fromApprovals, patch.toApprovals);
    }

    return { success: false, error: "Invalid governance patch format" };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Adjust a condition level on a PolicyRule.
 *
 * Example: change `params: { level: "high" }` to `params: { level: "medium" }`
 * for a condition of type "risk_threshold" on a specific rule.
 */
async function applyPolicyRuleTuning(
  content: string,
  ruleId: string,
  conditionType: string,
  fromLevel: string,
  toLevel: string,
): Promise<{ success: boolean; newContent?: string; error?: string }> {
  // Find the rule by ID.
  const ruleStart = content.indexOf(`id: "${ruleId}"`);
  if (ruleStart === -1) {
    // Try alternate format.
    const altStart = content.indexOf(`id: '${ruleId}'`);
    if (altStart === -1) {
      return { success: false, error: `PolicyRule with id "${ruleId}" not found` };
    }
  }

  // Find the conditions array within this rule.
  const conditionsStart = content.indexOf("conditions:", ruleStart);
  if (conditionsStart === -1) {
    return { success: false, error: `Rule ${ruleId} has no conditions array` };
  }

  // Find the matching condition by type.
  const conditionPattern = new RegExp(
    `type:\\s*["']${escapeRegex(conditionType)}["'][\\s\\S]*?level:\\s*["']${escapeRegex(fromLevel)}["']`,
  );

  const match = conditionPattern.exec(content.slice(conditionsStart));
  if (!match) {
    return {
      success: false,
      error: `Condition "${conditionType}" with level "${fromLevel}" not found in rule ${ruleId}`,
    };
  }

  // Apply the replacement.
  const matchStart = conditionsStart + match.index;
  const matchEnd = matchStart + match[0].length;
  const newContent = content.slice(0, matchStart) + match[0].replace(fromLevel, toLevel) + content.slice(matchEnd);

  return { success: true, newContent };
}

/**
 * Adjust minApprovals for a risk level in the ApprovalMatrix.
 *
 * Example: change `critical: { ..., minApprovals: 2 }` to `minApprovals: 3`.
 */
async function applyApprovalMatrixTuning(
  content: string,
  riskLevel: RiskLevel,
  fromApprovals: number,
  toApprovals: number,
): Promise<{ success: boolean; newContent?: string; error?: string }> {
  // Find the risk level section in the ApprovalMatrix.
  const levelPattern = new RegExp(
    `${riskLevel}:\\s*\\{[^}]*minApprovals:\\s*${fromApprovals}\\b`,
    "s",
  );

  const match = levelPattern.exec(content);
  if (!match) {
    return {
      success: false,
      error: `ApprovalMatrix entry for "${riskLevel}" with minApprovals=${fromApprovals} not found`,
    };
  }

  const newContent =
    content.slice(0, match.index) +
    match[0].replace(`minApprovals: ${fromApprovals}`, `minApprovals: ${toApprovals}`) +
    content.slice(match.index + match[0].length);

  return { success: true, newContent };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
