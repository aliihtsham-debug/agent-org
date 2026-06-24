// ── Meta-Loop Types ──────────────────────────────────────────────────────
// Types for the self-evolving meta-loop (Phase A+).
// See src/meta-loop/ for the implementation that consumes these.

import type { AgentRole } from "./agent-types.js";

/**
 * Canonical per-run record. One line of `outputs/.meta/runs.jsonl`.
 * Captures the minimum signal needed for cross-run aggregation without
 * re-reading every artifact.
 */
export interface RunSummary {
  runId: string;
  timestamp: string;
  /** SHA-256 of the idea, truncated to 16 chars — privacy-preserving. */
  ideaHash: string;
  status: "complete" | "partial" | "failed";
  totalAgents: number;
  totalTokens: { input: number; output: number };
  totalDurationMs: number;
  /** Number of critiques at or above the minSeverity threshold. */
  actionableCritiques: number;
  /** Breakdown by severity across all critiques. */
  critiqueBreakdown: { critical: number; high: number; medium: number; low: number; none: number };
  /** Number of governance policy denials during this run. */
  governanceDenials: number;
  /** IDs of proposals consumed (applied) by this run. */
  appliedProposalIds: string[];
  /** SHA-256 of the prompts file at run time — enables A/B prompt comparison. */
  promptVersion: string;
  /** SHA-256 of the policy templates at run time. */
  governanceVersion: string;
  /** Per-role aggregate metrics (only roles that ran). */
  roleMetrics: Record<AgentRole, RoleMetric>;
}

/** Per-role slice of RunSummary. Optional because a role may not have run. */
export interface RoleMetric {
  status: "completed" | "partial" | "failed" | "skipped" | "pending" | "in_progress";
  tokenUsage: { input: number; output: number };
  durationMs: number;
  /** Total artifact size in bytes (0 if no artifacts). */
  artifactSizeBytes?: number;
  /** Reputation score after this run (0-100), if memory was enabled. */
  reputationScore?: number;
}

/**
 * Category of a proposed change. Used for filtering, blast-radius limits,
 * and human-gate routing.
 */
export type ProposalCategory =
  | "prompt"
  | "governance"
  | "ceo-config"
  | "review-pair"
  | "reputation-weight";

/**
 * Status lifecycle of a proposal.
 *   pending → applied | rejected | superseded
 *   applied → rolled-back
 */
export type ProposalStatus =
  | "pending"
  | "applied"
  | "rejected"
  | "rolled-back"
  | "superseded";

/**
 * A single proposed change to a governed file (prompts, governance, CEO config).
 * Stored in `outputs/.meta/proposals/<date>/<runId>.json`.
 */
export interface ProposedChange {
  /** SHA-256 of (sourceFile + patch + timestamp), truncated to 12 chars. */
  proposalId: string;
  createdAt: string;
  /** Relative path from repo root (e.g., "src/prompts/agent-prompts.ts"). */
  sourceFile: string;
  /** Unified-diff patch text. */
  patch: string;
  /** SHA-256 of the file contents BEFORE applying this patch. */
  beforeHash: string;
  /** SHA-256 of the file contents AFTER applying this patch. */
  afterHash: string;
  category: ProposalCategory;
  /** Which proposer rule fired (e.g., "rule_criticalFindingRepeats"). */
  ruleId: string;
  /** Confidence score 0-1, derived from signal strength + window size. */
  confidence: number;
  /** Human-readable signal names that drove this proposal. */
  signals: string[];
  status: ProposalStatus;
  appliedAt?: string;
  rolledBackAt?: string;
  rejectionReason?: string;
  /** Links this proposal to the run and findings that motivated it. */
  provenance: {
    runId: string;
    ruleId: string;
    /** Stable findingIds that drove this proposal (if any). */
    findingIds?: string[];
  };
}

/**
 * Sliding-window aggregate metrics computed from the last N runs.
 * Input to the proposer rules.
 */
export interface SignalWindow {
  windowSize: number;
  /** Per-role aggregate metrics across the window. */
  roleWindows: Record<AgentRole, RoleWindow>;
  /** Per-review-pair critique incidence across the window. */
  pairWindows: Record<string, PairWindow>;
  /** Governance denial counts keyed by ruleId. */
  governanceDenials: Record<string, number>;
  /** Average fix acceptance rate across the window (0-1). */
  fixAcceptanceRate: number;
  /** Total runs in the window. */
  totalRuns: number;
}

/** Per-role aggregate across N runs. */
export interface RoleWindow {
  role: AgentRole;
  runCount: number;
  failureRate: number;          // 0-1
  avgTokenUtilization: number;  // 0-1 (output tokens / max tokens)
  avgDurationMs: number;
  avgSeverity: number;          // 0-4 (none→critical)
  reputationTrend: number;      // delta over window (negative = declining)
  emptyOutputCount: number;
}

/** Per-review-pair aggregate across N runs. */
export interface PairWindow {
  reviewer: AgentRole;
  reviewee: AgentRole;
  totalCritiques: number;
  avgFindingsCount: number;
  severityDistribution: { critical: number; high: number; medium: number; low: number; none: number };
  fixAcceptanceRate: number;    // 0-1
}

/**
 * User-configurable gates for the meta-loop.
 * Stored in `outputs/.meta/config.json`.
 */
export interface MetaLoopConfig {
  enabled: boolean;
  mode: "advisory" | "capture" | "propose" | "apply" | "auto";
  /** Number of prior runs to aggregate over. */
  windowSize: number;
  /** Minimum confidence to auto-apply (0-1). */
  minConfidence: number;
  /** Max prompt edits per governed file per run. */
  maxPromptEditsPerRun: number;
  /** Max governance tunings per template per run. */
  maxGovernanceTuningsPerRun: number;
  /** Max CEO lever changes per run. */
  maxCEOLeverChangesPerRun: number;
  /** Whether to allow adding new PolicyRules (vs. only tuning existing). */
  allowRuleAdditions: boolean;
  /** Whether human gate is required (--meta=apply y/n). */
  requireHumanGate: boolean;
  /** Whether to use an LLM summarizer for proposal generation (Phase D). */
  enableLLMProposer: boolean;
  /** Debounce window in ms to avoid feedback-loop thrashing. */
  debounceMs: number;
}

/**
 * Default meta-loop configuration. Sensible starting point; users can
 * override via `outputs/.meta/config.json`.
 */
export const DEFAULT_META_LOOP_CONFIG: MetaLoopConfig = {
  enabled: false,
  mode: "advisory",
  windowSize: 10,
  minConfidence: 0.8,
  maxPromptEditsPerRun: 1,
  maxGovernanceTuningsPerRun: 1,
  maxCEOLeverChangesPerRun: 1,
  allowRuleAdditions: false,
  requireHumanGate: true,
  enableLLMProposer: false,
  debounceMs: 300_000, // 5 minutes
};
