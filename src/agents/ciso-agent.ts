import type { AgentResult } from "../types/agent-types.js";
import { runOrchestratorAgent, type AgentContext } from "./base-agent.js";
import { runSecurityICs } from "./ic-agents.js";

/**
 * Run the CISO (Chief Information Security Officer) orchestrator agent.
 *
 * Produces a security strategy, then spawns Security Auditor, Vulnerability Scanner,
 * and Compliance Agent in parallel. Aggregates all security IC results.
 */
export async function runCISOAgent(
  idea: string,
  ctx: AgentContext,
): Promise<AgentResult> {
  return runOrchestratorAgent(idea, ctx, {
    role: "ciso",
    task: "Create a security strategy for",
    outputPath: "security/ciso",
    icSpawner: (icCtx, summary) => runSecurityICs(idea, icCtx, summary),
    summaryPrefix: "Security strategy",
  });
}
