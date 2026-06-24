import type { AgentRole, CritiqueResult } from "../types/agent-types.js";
import { extractJsonBlock } from "../agents/base-agent.js";
import { createHash } from "node:crypto";

const SEVERITY_LEVELS = ["critical", "high", "medium", "low", "none"] as const;

/**
 * Generate a stable findingId for cross-run dedup.
 * SHA-256(reviewer + reviewee + findingText).slice(0,16).
 */
export function generateFindingId(reviewer: AgentRole, reviewee: AgentRole, findingText: string): string {
  const canonical = `${reviewer}|${reviewee}|${findingText.trim().toLowerCase()}`;
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

// Re-export extractJsonBlock for use by refinement-phase.ts consumers
export { extractJsonBlock };

/**
 * Parse a structured critique from reviewer agent output.
 *
 * Expected JSON format:
 * ```json
 * {
 *   "severity": "high",
 *   "findings": ["Finding 1", "Finding 2"],
 *   "summary": "Brief summary of the critique"
 * }
 * ```
 *
 * Falls back to treating the full text as a single finding with "medium" severity
 * if no structured JSON is found.
 */
export function parseCritique(
  text: string,
  reviewer: AgentRole,
  reviewee: AgentRole,
): CritiqueResult {
  const parsed = extractJsonBlock(text);

  if (parsed) {
    const rawSeverity = String(parsed.severity ?? "medium").toLowerCase();
    const severity = SEVERITY_LEVELS.includes(rawSeverity as typeof SEVERITY_LEVELS[number])
      ? (rawSeverity as CritiqueResult["severity"])
      : "medium";

    const findings = Array.isArray(parsed.findings)
      ? parsed.findings.map(String)
      : parsed.summary
        ? [String(parsed.summary)]
        : [];

    const critique = parsed.summary
      ? String(parsed.summary)
      : findings.join("; ");

    // Generate stable findingIds for cross-run dedup + acceptance tracking.
    const findingIds = findings.map((f) => generateFindingId(reviewer, reviewee, f));

    return { reviewer, reviewee, critique, severity, findings, findingIds };
  }

  // Fallback: no structured JSON found — use the full text
  const trimmed = text.trim();
  const fallbackFindings = trimmed ? [trimmed] : ["No actionable critique produced."];
  const findingIds = fallbackFindings.map((f) => generateFindingId(reviewer, reviewee, f));

  return {
    reviewer,
    reviewee,
    critique: trimmed || "No actionable critique produced.",
    severity: "medium",
    findings: fallbackFindings,
    findingIds,
  };
}
