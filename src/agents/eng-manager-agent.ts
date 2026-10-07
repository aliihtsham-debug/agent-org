import type { AgentResult } from "../types/agent-types.js";
import type { AgentContext } from "./base-agent.js";
import { runEngineeringICs } from "./ic-agents.js";
import { withEnterpriseOrchestrator } from "./base-agent.js";

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
  return withEnterpriseOrchestrator(idea, ctx, {
    role: "engineering-manager",
    displayName: "Engineering Manager Agent",
    riskLevel: "medium",
    delegationDepth: 2,
    delegationFrom: "CTO",
    delegationPermissions: ["spawn", "delegate", "write_file"],
    task: "Create an engineering plan for",
    outputPath: "architecture/eng-manager",
    spawner: (icCtx, summary) => runEngineeringICs(idea, icCtx, archSummary, productSummary, summary),
    summaryPrefix: "Engineering plan",
    orchestratorType: "orchestrator",
    extraContext: `## Architecture Summary\n${archSummary}\n\n## Product Summary\n${productSummary}`,
  });
}