import type { AgentResult } from "../types/agent-types.js";
import type { AgentContext } from "./base-agent.js";
import { runPMICs } from "./ic-agents.js";
import { withEnterpriseOrchestrator } from "./base-agent.js";

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
  return withEnterpriseOrchestrator(idea, ctx, {
    role: "pm",
    displayName: "PM Agent",
    riskLevel: "medium",
    delegationDepth: 1,
    delegationFrom: "CEO",
    delegationPermissions: ["spawn", "delegate", "write_file"],
    task: "Create a product strategy summary for",
    outputPath: "specs/pm",
    spawner: (icCtx, summary) => runPMICs(idea, icCtx, summary),
    summaryPrefix: "Product strategy",
    orchestratorType: "orchestrator",
  });
}