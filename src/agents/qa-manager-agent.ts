import type { AgentResult } from "../types/agent-types.js";
import { runOrchestratorAgent, type AgentContext } from "./base-agent.js";
import { runQAICs } from "./ic-agents.js";

/**
 * Run the QA Manager orchestrator agent.
 *
 * Produces a QA strategy, then spawns Testing Agent and Performance Agent
 * in parallel. Aggregates both QA IC results.
 */
export async function runQAManagerAgent(
  idea: string,
  ctx: AgentContext,
  archSummary: string,
  productSummary: string,
): Promise<AgentResult> {
  return runOrchestratorAgent(idea, ctx, {
    role: "qa-manager",
    task: "Create a QA strategy for",
    outputPath: "tests/qa-manager",
    icSpawner: (icCtx, summary) => runQAICs(idea, icCtx, archSummary, productSummary, summary),
    summaryPrefix: "QA strategy",
    extraContext: `## Architecture Summary\n${archSummary}\n\n## Product Summary\n${productSummary}`,
  });
}
