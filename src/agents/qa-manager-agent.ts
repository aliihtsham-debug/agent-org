import type { AgentResult } from "../types/agent-types.js";
import type { AgentContext } from "./base-agent.js";
import { runQAICs } from "./ic-agents.js";
import { withEnterpriseOrchestrator } from "./base-agent.js";

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
  return withEnterpriseOrchestrator(idea, ctx, {
    role: "qa-manager",
    displayName: "QA Manager Agent",
    riskLevel: "medium",
    delegationDepth: 2,
    delegationFrom: "CTO",
    delegationPermissions: ["spawn", "delegate", "write_file"],
    task: "Create a QA strategy for",
    outputPath: "tests/qa-manager",
    spawner: (icCtx, summary) => runQAICs(idea, icCtx, archSummary, productSummary, summary),
    summaryPrefix: "QA strategy",
    orchestratorType: "orchestrator",
    extraContext: `## Architecture Summary\n${archSummary}\n\n## Product Summary\n${productSummary}`,
  });
}