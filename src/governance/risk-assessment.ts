/**
 * Phase 9 -- Risk Assessment
 *
 * Maps agent actions to risk levels and assesses aggregate plan risk.
 */

import type { RiskLevel, GovernanceContext } from "../types/governance-types.js";
import type { AgentResult } from "../types/agent-types.js";

/**
 * Assess the risk level of a single action given the governance context.
 *
 * Risk mapping:
 * - external_api_call, git_push, deploy, publish, shell_exec -> critical
 * - write_file, create_artifact, web_search, web_fetch -> medium
 * - read_file, list_files, search_code, query -> low
 * - Unknown actions default to medium
 * - Risk is elevated when delegation depth >= 3
 */
export function assessRisk(action: string, context: GovernanceContext | string): RiskLevel {
  // Overload: allow calling with just a string risk level (backward-compatible)
  if (typeof context === "string") {
    return context as RiskLevel;
  }
  const criticalActions = [
    "external_api_call",
    "git_push",
    "deploy",
    "publish",
    "delete_database",
    "drop_table",
    "process_payment",
    "transfer_funds",
    "shell_exec",
    "exec_command",
  ];

  const highActions = [
    "modify_pricing",
    "update_budget",
    "rm_rf",
    "format_disk",
  ];

  const mediumActions = [
    "write_file",
    "create_artifact",
    "update_status",
  ];

  const lowActions = [
    "read_file",
    "list_files",
    "search_code",
    "query",
    "web_search",
    "web_fetch",
  ];

  const minimalActions = [
    "read",
    "list",
    "search",
  ];

  let baseRisk: RiskLevel;
  if (criticalActions.includes(action)) {
    baseRisk = "critical";
  } else if (highActions.includes(action)) {
    baseRisk = "high";
  } else if (mediumActions.includes(action)) {
    baseRisk = "medium";
  } else if (lowActions.includes(action)) {
    baseRisk = "low";
  } else if (minimalActions.includes(action)) {
    baseRisk = "minimal";
  } else {
    baseRisk = "medium";
  }

  // Elevate risk at high delegation depth
  if (context.delegationDepth >= 3 && baseRisk !== "critical") {
    const elevation: Record<string, RiskLevel> = {
      minimal: "low",
      low: "medium",
      medium: "high",
      high: "critical",
    };
    return elevation[baseRisk] ?? baseRisk;
  }

  return baseRisk;
}

/**
 * Assess the overall risk level of an agent action plan by examining
 * all agent results and their statuses.
 *
 * - If any agents failed AND some were partial -> high
 * - If any agents failed -> medium
 * - If any agents were partial -> low
 * - All completed -> minimal
 * - Empty results -> minimal
 */
export function assessAgentActionPlan(agentResults: AgentResult[]): RiskLevel {
  if (agentResults.length === 0) {
    return "minimal";
  }

  const hasFailures = agentResults.some((r) => r.status === "failed");
  const hasPartial = agentResults.some((r) => r.status === "partial");

  if (hasFailures && hasPartial) return "high";
  if (hasFailures) return "medium";
  if (hasPartial) return "low";

  return "minimal";
}

/**
 * Return a numeric rank for a risk level.
 */
export function riskRank(level: RiskLevel): number {
  const ranks: Record<RiskLevel, number> = {
    minimal: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  return ranks[level];
}

