import type { AgentResult } from "../types/agent-types.js";
import type { AgentContext } from "./base-agent.js";
import { runFinanceICs } from "./ic-agents.js";
import { withEnterpriseOrchestrator } from "./base-agent.js";

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
  return withEnterpriseOrchestrator(idea, ctx, {
    role: "cfo",
    displayName: "CFO Agent",
    riskLevel: "medium",
    delegationDepth: 1,
    delegationFrom: "CEO",
    delegationPermissions: ["spawn", "delegate", "write_file"],
    task: "Create a financial overview for",
    outputPath: "finance/cfo",
    spawner: (icCtx, summary) => runFinanceICs(idea, icCtx, summary),
    summaryPrefix: "Financial overview",
    orchestratorType: "orchestrator",
  });
}