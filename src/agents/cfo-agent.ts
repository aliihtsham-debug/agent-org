import type { AgentResult } from "../types/agent-types.js";
import { runOrchestratorAgent, type AgentContext } from "./base-agent.js";
import { runFinanceICs } from "./ic-agents.js";

/**
 * Run the CFO (Chief Financial Officer) orchestrator agent.
 *
 * Produces a financial overview, then spawns Budget Agent and Pricing Agent
 * in parallel. Aggregates both finance IC results.
 */
export async function runCFOAgent(
  idea: string,
  ctx: AgentContext,
): Promise<AgentResult> {
  return runOrchestratorAgent(idea, ctx, {
    role: "cfo",
    task: "Create a financial overview for",
    outputPath: "finance/cfo",
    icSpawner: (icCtx, summary) => runFinanceICs(idea, icCtx, summary),
    summaryPrefix: "Financial overview",
  });
}
