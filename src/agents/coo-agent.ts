import type { AgentResult } from "../types/agent-types.js";
import { runOrchestratorAgent, type AgentContext } from "./base-agent.js";
import { runOperationsICs } from "./ic-agents.js";

/**
 * Run the COO (Chief Operating Officer) orchestrator agent.
 *
 * Produces an operations plan, then spawns Scheduler, Workflow, and Monitoring
 * agents in parallel. Aggregates all operations IC results.
 */
export async function runCOOAgent(
  idea: string,
  ctx: AgentContext,
): Promise<AgentResult> {
  return runOrchestratorAgent(idea, ctx, {
    role: "coo",
    task: "Create an operations plan for",
    outputPath: "operations/coo",
    icSpawner: (icCtx, summary) => runOperationsICs(idea, icCtx, summary),
    summaryPrefix: "Operations plan",
  });
}
