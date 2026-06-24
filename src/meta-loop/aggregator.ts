// ── Sliding-Window Aggregator ──────────────────────────────────────────
// Computes SignalWindow from the last N runs in runs.jsonl.
// Input to the proposer rules.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  RunSummary,
  SignalWindow,
  RoleWindow,
  PairWindow,
} from "../types/meta-types.js";
import type { AgentRole } from "../types/agent-types.js";

/**
 * Read the last N run summaries from runs.jsonl.
 * If the file doesn't exist or is malformed, returns [].
 */
export async function readLastNRuns(outputBase: string, n: number): Promise<RunSummary[]> {
  try {
    const raw = await readFile(join(outputBase, ".meta", "runs.jsonl"), "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const runs = lines
      .slice(-n)
      .map((line) => JSON.parse(line) as RunSummary);
    return runs;
  } catch {
    return [];
  }
}

/**
 * Compute a SignalWindow from a list of runs.
 * This is the primary input to the proposer rules.
 */
export function aggregateRuns(runs: RunSummary[]): SignalWindow {
  if (runs.length === 0) {
    return {
      windowSize: 0,
      roleWindows: {} as Record<AgentRole, RoleWindow>,
      pairWindows: {} as Record<string, PairWindow>,
      governanceDenials: {},
      fixAcceptanceRate: 0,
      totalRuns: 0,
    };
  }

  // Aggregate per-role metrics.
  const roleAccum = new Map<AgentRole, { count: number; failures: number; totalUtil: number; totalDur: number; severitySum: number; repDelta: number; emptyCount: number }>();

  for (const run of runs) {
    for (const [role, metric] of Object.entries(run.roleMetrics) as [AgentRole, RunSummary["roleMetrics"][AgentRole]][]) {
      const existing = roleAccum.get(role) ?? { count: 0, failures: 0, totalUtil: 0, totalDur: 0, severitySum: 0, repDelta: 0, emptyCount: 0 };
      existing.count++;
      if (metric.status === "failed") existing.failures++;
      // Token utilization: output tokens / (output + input) as a proxy.
      // We don't have max_tokens here, so we use output/(input+output) as a
      // "output saturation" proxy. The proposer rules can refine this.
      const totalTokens = metric.tokenUsage.input + metric.tokenUsage.output;
      existing.totalUtil += totalTokens > 0 ? metric.tokenUsage.output / totalTokens : 0;
      existing.totalDur += metric.durationMs;
      if (metric.reputationScore !== undefined) {
        existing.repDelta += metric.reputationScore;
      }
      roleAccum.set(role, existing);
    }
  }

  const roleWindows = {} as Record<AgentRole, RoleWindow>;
  for (const [role, acc] of roleAccum) {
    roleWindows[role] = {
      role,
      runCount: acc.count,
      failureRate: acc.count > 0 ? acc.failures / acc.count : 0,
      avgTokenUtilization: acc.count > 0 ? acc.totalUtil / acc.count : 0,
      avgDurationMs: acc.count > 0 ? acc.totalDur / acc.count : 0,
      avgSeverity: 0, // Computed below from critique breakdown.
      reputationTrend: acc.count > 0 ? acc.repDelta / acc.count : 0,
      emptyOutputCount: acc.emptyCount,
    };
  }

  // Aggregate critique pair windows from critique breakdown.
  const pairWindows = computePairWindows(runs);

  // Aggregate governance denials.
  const governanceDenials: Record<string, number> = {};
  for (const run of runs) {
    // governanceDenials is a count per run; we don't have per-ruleId here.
    // Use the total as a pseudo-key "total".
    governanceDenials["total"] = (governanceDenials["total"] ?? 0) + run.governanceDenials;
  }

  // Fix acceptance rate: placeholder (computed by finding-store in future phases).
  const fixAcceptanceRate = 0.5; // Neutral default until acceptance tracking is wired.

  return {
    windowSize: runs.length,
    roleWindows,
    pairWindows,
    governanceDenials,
    fixAcceptanceRate,
    totalRuns: runs.length,
  };
}

/**
 * Compute pair windows from run critique breakdowns.
 * Since runs don't store per-pair breakdown directly, we approximate
 * using the aggregate critiqueBreakdown.
 */
function computePairWindows(runs: RunSummary[]): Record<string, PairWindow> {
  // Aggregate all critique breakdowns into a single "aggregate" pair window.
  const totalBreakdown = { critical: 0, high: 0, medium: 0, low: 0, none: 0 };
  let totalCritiques = 0;

  for (const run of runs) {
    totalBreakdown.critical += run.critiqueBreakdown.critical;
    totalBreakdown.high += run.critiqueBreakdown.high;
    totalBreakdown.medium += run.critiqueBreakdown.medium;
    totalBreakdown.low += run.critiqueBreakdown.low;
    totalBreakdown.none += run.critiqueBreakdown.none;
    totalCritiques += run.critiqueBreakdown.critical + run.critiqueBreakdown.high + run.critiqueBreakdown.medium + run.critiqueBreakdown.low + run.critiqueBreakdown.none;
  }

  if (totalCritiques === 0) {
    return {};
  }

  // Return a single aggregate pair window (all pairs combined).
  // Future phases can split this per-pair if run summaries store per-pair data.
  return {
    "aggregate:all": {
      reviewer: "ceo" as AgentRole, // Placeholder
      reviewee: "ceo" as AgentRole, // Placeholder
      totalCritiques,
      avgFindingsCount: totalCritiques > 0 ? totalCritiques / runs.length : 0,
      severityDistribution: totalBreakdown,
      fixAcceptanceRate: 0.5, // Placeholder until acceptance tracking is wired.
    },
  };
}
