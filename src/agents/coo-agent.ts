import type { AgentResult } from "../types/agent-types.js";
import type { AgentContext } from "./base-agent.js";
import { runOperationsICs } from "./ic-agents.js";
import { withEnterpriseOrchestrator } from "./base-agent.js";

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
  return withEnterpriseOrchestrator(idea, ctx, {
    role: "coo",
    displayName: "COO Agent",
    riskLevel: "medium",
    delegationDepth: 1,
    delegationFrom: "CEO",
    delegationPermissions: ["spawn", "delegate", "write_file"],
    task: "Create an operations plan for",
    outputPath: "operations/coo",
    spawner: (icCtx, summary) => runOperationsICs(idea, icCtx, summary),
    summaryPrefix: "Operations plan",
    orchestratorType: "orchestrator",
  });
}