import type { AgentResult } from "../types/agent-types.js";
import { runOrchestratorAgent, type AgentContext } from "./base-agent.js";
import { runPMICs } from "./ic-agents.js";

/**
 * Run the PM (Product Manager) orchestrator agent.
 *
 * Produces a product strategy overview, then spawns UX Researcher,
 * Roadmap Agent, and Analytics Agent in parallel. Aggregates all IC results.
 */
export async function runPMAgent(
  idea: string,
  ctx: AgentContext,
): Promise<AgentResult> {
  return runOrchestratorAgent(idea, ctx, {
    role: "pm",
    task: "Create a product strategy summary for",
    outputPath: "specs/pm",
    icSpawner: (icCtx, summary) => runPMICs(idea, icCtx, summary),
    summaryPrefix: "Product strategy",
  });
}
