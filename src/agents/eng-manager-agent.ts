import type { AgentResult } from "../types/agent-types.js";
import { runOrchestratorAgent, type AgentContext } from "./base-agent.js";
import { runEngineeringICs } from "./ic-agents.js";

/**
 * Run the Engineering Manager orchestrator agent.
 *
 * Produces an engineering plan, then spawns Frontend, Backend, AI, and DevOps
 * engineers in parallel. Aggregates all engineering IC results.
 */
export async function runEngManagerAgent(
  idea: string,
  ctx: AgentContext,
  archSummary: string,
  productSummary: string,
): Promise<AgentResult> {
  return runOrchestratorAgent(idea, ctx, {
    role: "engineering-manager",
    task: "Create an engineering plan for",
    outputPath: "architecture/eng-manager",
    icSpawner: (icCtx, summary) => runEngineeringICs(idea, icCtx, archSummary, productSummary, summary),
    summaryPrefix: "Engineering plan",
    extraContext: `## Architecture Summary\n${archSummary}\n\n## Product Summary\n${productSummary}`,
  });
}
