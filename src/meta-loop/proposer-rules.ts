// ── Proposer Rules ─────────────────────────────────────────────────────
// Pure functions that turn a SignalWindow into ProposedChange[].
// Each rule is a function: (window, context) → ProposedChange[].
//
// Rules do NOT modify files directly — they return proposals that the
// meta-orchestrator gates (human, confidence, blast-radius) before applying.

import { createHash } from "node:crypto";
import type {
  SignalWindow,
  ProposedChange,
  ProposalCategory,
} from "../types/meta-types.js";
import type { AgentRole } from "../types/agent-types.js";

export interface ProposerContext {
  /** Run ID that triggered this proposal pass. */
  runId: string;
  /** SHA-256 hash of the governed file's current content (for beforeHash). */
  currentFileHashes: Record<string, string>;
}

export interface ProposerRule {
  id: string;
  description: string;
  /** Whether this rule is active in the given mode. */
  enabled: (mode: string) => boolean;
  evaluate: (window: SignalWindow, ctx: ProposerContext) => ProposedChange[];
}

/**
 * Rule 1: Critical finding repeats.
 * If the same findingId appears ≥ `minOccurrences` times in the window,
 * propose a prompt edit for the reviewee.
 */
export const rule_criticalFindingRepeats: ProposerRule = {
  id: "rule_criticalFindingRepeats",
  description: "Propose prompt edit when a finding repeats across multiple runs",
  enabled: (mode) => mode !== "capture",
  evaluate: (window, ctx) => {
    const proposals: ProposedChange[] = [];
    const minOccurrences = 3;

    for (const [role, roleWindow] of Object.entries(window.roleWindows) as [AgentRole, SignalWindow["roleWindows"][AgentRole]][]) {
      // Skip roles with insufficient data.
      if (roleWindow.runCount < minOccurrences) continue;

      // Check if the role has high failure rate or high severity.
      if (roleWindow.failureRate > 0.3 || roleWindow.avgSeverity > 2.5) {
        const proposalId = makeProposalId(ctx.runId, role, "prompt");
        proposals.push({
          proposalId,
          createdAt: new Date().toISOString(),
          sourceFile: "src/prompts/agent-prompts.ts",
          patch: JSON.stringify({
            oldText: `Agent "${role}" has repeated quality issues across ${roleWindow.runCount} runs.`,
            newText: `Agent "${role}" prompt needs strengthening. Failure rate: ${(roleWindow.failureRate * 100).toFixed(0)}%.`,
          }),
          beforeHash: ctx.currentFileHashes["src/prompts/agent-prompts.ts"] ?? "unknown",
          afterHash: "pending", // Computed at apply time
          category: "prompt",
          ruleId: "rule_criticalFindingRepeats",
          confidence: Math.min(1, roleWindow.failureRate + 0.3),
          signals: [`failure_rate=${roleWindow.failureRate.toFixed(2)}`, `runs=${roleWindow.runCount}`],
          status: "pending",
          provenance: { runId: ctx.runId, ruleId: "rule_criticalFindingRepeats" },
        });
      }
    }

    return proposals;
  },
};

/**
 * Rule 2: Low fix acceptance.
 * If fixAcceptanceRate < 0.4 for a pair, propose strengthening the reviewer
 * prompt or adding a new review pair.
 */
export const rule_lowFixAcceptance: ProposerRule = {
  id: "rule_lowFixAcceptance",
  description: "Propose reviewer prompt strengthening when fixes are rarely accepted",
  enabled: (mode) => mode !== "capture",
  evaluate: (window, ctx) => {
    const proposals: ProposedChange[] = [];

    for (const [pairKey, pairWindow] of Object.entries(window.pairWindows)) {
      if (pairWindow.fixAcceptanceRate < 0.4 && pairWindow.totalCritiques >= 3) {
        const proposalId = makeProposalId(ctx.runId, pairKey, "review-pair");
        proposals.push({
          proposalId,
          createdAt: new Date().toISOString(),
          sourceFile: "src/refinement/review-pairs.ts",
          patch: JSON.stringify({
            oldText: `Pair ${pairKey} has low acceptance: ${pairWindow.fixAcceptanceRate.toFixed(2)}`,
            newText: `Pair ${pairKey} needs stronger reviewer prompt`,
          }),
          beforeHash: ctx.currentFileHashes["src/refinement/review-pairs.ts"] ?? "unknown",
          afterHash: "pending",
          category: "review-pair",
          ruleId: "rule_lowFixAcceptance",
          confidence: Math.min(1, 1 - pairWindow.fixAcceptanceRate),
          signals: [`fix_acceptance=${pairWindow.fixAcceptanceRate.toFixed(2)}`, `critiques=${pairWindow.totalCritiques}`],
          status: "pending",
          provenance: { runId: ctx.runId, ruleId: "rule_lowFixAcceptance" },
        });
      }
    }

    return proposals;
  },
};

/**
 * Rule 3: Token saturation.
 * If a role's token utilization > 0.85, propose tightening outputFormat.
 */
export const rule_tokenSaturation: ProposerRule = {
  id: "rule_tokenSaturation",
  description: "Propose output format tightening when token utilization is high",
  enabled: (mode) => mode !== "capture",
  evaluate: (window, ctx) => {
    const proposals: ProposedChange[] = [];

    for (const [role, roleWindow] of Object.entries(window.roleWindows) as [AgentRole, SignalWindow["roleWindows"][AgentRole]][]) {
      if (roleWindow.avgTokenUtilization > 0.85 && roleWindow.runCount >= 3) {
        const proposalId = makeProposalId(ctx.runId, role, "token");
        proposals.push({
          proposalId,
          createdAt: new Date().toISOString(),
          sourceFile: "src/prompts/agent-prompts.ts",
          patch: JSON.stringify({
            oldText: `Role ${role} token saturation: ${roleWindow.avgTokenUtilization.toFixed(2)}`,
            newText: `Role ${role} needs tighter output format`,
          }),
          beforeHash: ctx.currentFileHashes["src/prompts/agent-prompts.ts"] ?? "unknown",
          afterHash: "pending",
          category: "prompt",
          ruleId: "rule_tokenSaturation",
          confidence: Math.min(1, roleWindow.avgTokenUtilization),
          signals: [`token_util=${roleWindow.avgTokenUtilization.toFixed(2)}`, `runs=${roleWindow.runCount}`],
          status: "pending",
          provenance: { runId: ctx.runId, ruleId: "rule_tokenSaturation" },
        });
      }
    }

    return proposals;
  },
};

/**
 * Rule 4: Governance denial spike.
 * If a ruleId fires ≥ 5 times in the window, propose loosening one level.
 */
export const rule_governanceDenialSpike: ProposerRule = {
  id: "rule_governanceDenialSpike",
  description: "Propose governance loosening when denials spike",
  enabled: (mode) => mode !== "capture",
  evaluate: (window, ctx) => {
    const proposals: ProposedChange[] = [];

    for (const [ruleId, count] of Object.entries(window.governanceDenials)) {
      if (count >= 5) {
        const proposalId = makeProposalId(ctx.runId, ruleId, "governance");
        proposals.push({
          proposalId,
          createdAt: new Date().toISOString(),
          sourceFile: "src/governance/policy-templates.ts",
          patch: JSON.stringify({
            oldText: `Rule ${ruleId} denied ${count} times`,
            newText: `Rule ${ruleId} needs loosening`,
          }),
          beforeHash: ctx.currentFileHashes["src/governance/policy-templates.ts"] ?? "unknown",
          afterHash: "pending",
          category: "governance",
          ruleId: "rule_governanceDenialSpike",
          confidence: Math.min(1, count / 10),
          signals: [`denials=${count}`, `rule=${ruleId}`],
          status: "pending",
          provenance: { runId: ctx.runId, ruleId: "rule_governanceDenialSpike" },
        });
      }
    }

    return proposals;
  },
};

/**
 * Rule 5: Reputation decline.
 * If a role's reputation drops ≥ 10 points across the window, propose
 * a CEO config change (e.g., +1 maxIterations).
 */
export const rule_reputationDecline: ProposerRule = {
  id: "rule_reputationDecline",
  description: "Propose CEO config change when reputation declines",
  enabled: (mode) => mode !== "capture",
  evaluate: (window, ctx) => {
    const proposals: ProposedChange[] = [];

    for (const [role, roleWindow] of Object.entries(window.roleWindows) as [AgentRole, SignalWindow["roleWindows"][AgentRole]][]) {
      if (roleWindow.reputationTrend <= -10 && roleWindow.runCount >= 3) {
        const proposalId = makeProposalId(ctx.runId, role, "ceo-config");
        proposals.push({
          proposalId,
          createdAt: new Date().toISOString(),
          sourceFile: "src/orchestrator/ceo-agent.ts",
          patch: JSON.stringify({
            oldText: `Role ${role} reputation dropped ${roleWindow.reputationTrend.toFixed(0)} points`,
            newText: `Role ${role} needs config adjustment`,
          }),
          beforeHash: ctx.currentFileHashes["src/orchestrator/ceo-agent.ts"] ?? "unknown",
          afterHash: "pending",
          category: "ceo-config",
          ruleId: "rule_reputationDecline",
          confidence: Math.min(1, Math.abs(roleWindow.reputationTrend) / 20),
          signals: [`rep_trend=${roleWindow.reputationTrend.toFixed(0)}`, `role=${role}`],
          status: "pending",
          provenance: { runId: ctx.runId, ruleId: "rule_reputationDecline" },
        });
      }
    }

    return proposals;
  },
};

/**
 * Rule 6: Empty output.
 * If a role produced empty artifacts, propose a prompt edit emphasizing
 * output format.
 */
export const rule_emptyOutput: ProposerRule = {
  id: "rule_emptyOutput",
  description: "Propose prompt edit when a role produces empty output",
  enabled: (mode) => mode !== "capture",
  evaluate: (window, ctx) => {
    const proposals: ProposedChange[] = [];

    for (const [role, roleWindow] of Object.entries(window.roleWindows) as [AgentRole, SignalWindow["roleWindows"][AgentRole]][]) {
      if (roleWindow.emptyOutputCount >= 2) {
        const proposalId = makeProposalId(ctx.runId, role, "empty-output");
        proposals.push({
          proposalId,
          createdAt: new Date().toISOString(),
          sourceFile: "src/prompts/agent-prompts.ts",
          patch: JSON.stringify({
            oldText: `Role ${role} produced empty output ${roleWindow.emptyOutputCount} times`,
            newText: `Role ${role} needs explicit output format requirements`,
          }),
          beforeHash: ctx.currentFileHashes["src/prompts/agent-prompts.ts"] ?? "unknown",
          afterHash: "pending",
          category: "prompt",
          ruleId: "rule_emptyOutput",
          confidence: Math.min(1, roleWindow.emptyOutputCount / 5),
          signals: [`empty_outputs=${roleWindow.emptyOutputCount}`, `role=${role}`],
          status: "pending",
          provenance: { runId: ctx.runId, ruleId: "rule_emptyOutput" },
        });
      }
    }

    return proposals;
  },
};

/**
 * Rule 7: Severity trend up.
 * If a role's severity trend is rising, propose adding a review pair
 * targeting that role.
 */
export const rule_severityTrendUp: ProposerRule = {
  id: "rule_severityTrendUp",
  description: "Propose adding review pair when severity trends upward",
  enabled: (mode) => mode === "auto" || mode === "propose",
  evaluate: (window, ctx) => {
    const proposals: ProposedChange[] = [];

    for (const [role, roleWindow] of Object.entries(window.roleWindows) as [AgentRole, SignalWindow["roleWindows"][AgentRole]][]) {
      if (roleWindow.avgSeverity > 2 && roleWindow.runCount >= 3) {
        const proposalId = makeProposalId(ctx.runId, role, "severity-trend");
        proposals.push({
          proposalId,
          createdAt: new Date().toISOString(),
          sourceFile: "src/refinement/review-pairs.ts",
          patch: JSON.stringify({
            oldText: `Role ${role} avg severity: ${roleWindow.avgSeverity.toFixed(1)}`,
            newText: `Role ${role} needs additional review coverage`,
          }),
          beforeHash: ctx.currentFileHashes["src/refinement/review-pairs.ts"] ?? "unknown",
          afterHash: "pending",
          category: "review-pair",
          ruleId: "rule_severityTrendUp",
          confidence: Math.min(1, roleWindow.avgSeverity / 4),
          signals: [`avg_severity=${roleWindow.avgSeverity.toFixed(1)}`, `runs=${roleWindow.runCount}`],
          status: "pending",
          provenance: { runId: ctx.runId, ruleId: "rule_severityTrendUp" },
        });
      }
    }

    return proposals;
  },
};

/**
 * All proposer rules, in evaluation order.
 * Order matters: earlier rules may produce proposals that later rules
 * check for (e.g., to avoid duplicate proposals).
 */
export const ALL_PROPOSER_RULES: ProposerRule[] = [
  rule_criticalFindingRepeats,
  rule_lowFixAcceptance,
  rule_tokenSaturation,
  rule_governanceDenialSpike,
  rule_reputationDecline,
  rule_emptyOutput,
  rule_severityTrendUp,
];

/**
 * Evaluate all enabled rules against a signal window.
 */
export function evaluateAllRules(window: SignalWindow, ctx: ProposerContext, mode: string): ProposedChange[] {
  const proposals: ProposedChange[] = [];
  const seenSources = new Set<string>();

  for (const rule of ALL_PROPOSER_RULES) {
    if (!rule.enabled(mode)) continue;
    const ruleProposals = rule.evaluate(window, ctx);
    for (const p of ruleProposals) {
      // Deduplicate by sourceFile (one edit per file per run).
      const key = `${p.sourceFile}:${p.category}`;
      if (seenSources.has(key)) continue;
      seenSources.add(key);
      proposals.push(p);
    }
  }

  return proposals;
}

/**
 * Generate a deterministic proposal ID.
 */
function makeProposalId(runId: string, subject: string, category: string): string {
  const canonical = `${runId}|${subject}|${category}|${Date.now()}`;
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}
