import type { AgentResult } from "../types/agent-types.js";
import { runManagerOrchestratorAgent, type AgentContext } from "./base-agent.js";
import { runEngManagerAgent } from "./eng-manager-agent.js";
import { runQAManagerAgent } from "./qa-manager-agent.js";

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
  return runManagerOrchestratorAgent(idea, ctx, {
    role: "cto",
    task: "Create an Architecture Decision Record (ADR) and system design for",
    outputPath: "architecture/cto",
    managerSpawner: (mgrCtx, archSummary) =>
      Promise.all([
        runEngManagerAgent(idea, mgrCtx, archSummary, ""),
        runQAManagerAgent(idea, mgrCtx, archSummary, ""),
      ]),
    summaryPrefix: "Architecture",
  });
}
