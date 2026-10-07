import type { AgentResult } from "../types/agent-types.js";
import type { AgentContext } from "./base-agent.js";
import { runSecurityICs } from "./ic-agents.js";
import { withEnterpriseOrchestrator } from "./base-agent.js";

/**
 * Run the CISO (Chief Information Security Officer) orchestrator agent.
 *
 * Produces a security strategy, then spawns Security Auditor, Vulnerability Scanner,
 * and Compliance Agent in parallel. Aggregates all security IC results.
 */
export async function runCISOAgent(
  idea: string,
  ctx: AgentContext,
): Promise<AgentResult> {
  return withEnterpriseOrchestrator(idea, ctx, {
    role: "ciso",
    displayName: "CISO Agent",
    riskLevel: "high",
    delegationDepth: 1,
    delegationFrom: "CEO",
    delegationPermissions: ["spawn", "delegate", "write_file"],
    task: "Create a security strategy for",
    outputPath: "security/ciso",
    spawner: (icCtx, summary) => runSecurityICs(idea, icCtx, summary),
    summaryPrefix: "Security strategy",
    orchestratorType: "orchestrator",
  });
}