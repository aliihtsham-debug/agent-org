import type { AgentRole, CritiqueResult } from "../types/agent-types.js";
import { extractJsonBlock } from "../agents/base-agent.js";

const SEVERITY_LEVELS = ["critical", "high", "medium", "low", "none"] as const;

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

    return { reviewer, reviewee, critique, severity, findings };
  }

  // Fallback: no structured JSON found — use the full text
  const trimmed = text.trim();
  return {
    reviewer,
    reviewee,
    critique: trimmed || "No actionable critique produced.",
    severity: "medium",
    findings: trimmed ? [trimmed] : ["No actionable critique produced."],
  };
}
