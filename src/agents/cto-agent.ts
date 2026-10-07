import type { AgentResult } from "../types/agent-types.js";
import { runManagerOrchestratorAgent, type AgentContext } from "./base-agent.js";
import { runEngManagerAgent } from "./eng-manager-agent.js";
import { runQAManagerAgent } from "./qa-manager-agent.js";
import { withEnterpriseOrchestrator } from "./base-agent.js";

/**
 * Run the CTO (Chief Technology Officer) orchestrator agent.
 *
 * Produces an Architecture Decision Record, then spawns Engineering Manager
 * and QA Manager in parallel. Collects IC results from both manager branches.
 */
export async function runCTOAgent(
  idea: string,
  ctx: AgentContext,
): Promise<AgentResult> {
  return withEnterpriseOrchestrator(idea, ctx, {
    role: "cto",
    displayName: "CTO Agent",
    riskLevel: "high",
    delegationDepth: 1,
    delegationFrom: "CEO",
    delegationPermissions: ["spawn", "delegate", "write_file"],
    task: "Create an Architecture Decision Record (ADR) and system design for",
    outputPath: "architecture/cto",
    spawner: (mgrCtx, archSummary) =>
      Promise.all([
        runEngManagerAgent(idea, mgrCtx, archSummary, ""),
        runQAManagerAgent(idea, mgrCtx, archSummary, ""),
      ]),
    summaryPrefix: "Architecture",
    orchestratorType: "manager",
  });
}