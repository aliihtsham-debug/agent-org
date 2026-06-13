import type { AgentResult } from "../types/agent-types.js";
import { runAgentWithRetry, type AgentContext } from "./base-agent.js";
import { runQAICs } from "./ic-agents.js";

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
  // Step 1: Produce QA strategy
  const strategySpec = {
    id: `qa-mgr-strategy-${Date.now()}`,
    role: "qa-manager" as const,
    task: `Create a QA strategy for: "${idea}"`,
    context: `## Architecture Summary\n${archSummary}\n\n## Product Summary\n${productSummary}`,
    outputPath: `${ctx.outputBase}/tests/qa-manager`,
  };

  const strategyResult = await runAgentWithRetry(strategySpec, ctx);

  if (strategyResult.status === "failed") {
    return strategyResult;
  }

  // Step 2: Publish and read strategy from registry (no disk round-trip, no truncation)
  ctx.resultsRegistry.publish(strategyResult);
  const strategySummary = ctx.resultsRegistry.getSummary("qa-manager") ?? strategyResult.summary;

  // Step 3: Spawn testing + performance ICs in parallel
  const icCtx: AgentContext = { ...ctx, parentRole: "qa-manager", enableWebTools: false };
  const icResults = await runQAICs(idea, icCtx, archSummary, productSummary, strategySummary);

  // Step 4: Aggregate IC results
  const failedICs = icResults.filter((r) => r.status === "failed");
  const succeededICs = icResults.filter((r) => r.status === "completed");

  const totalTokens = icResults.reduce(
    (sum, r) => sum + r.tokenUsage.input + r.tokenUsage.output,
    strategyResult.tokenUsage.input + strategyResult.tokenUsage.output,
  );

  const allArtifacts = [
    ...strategyResult.artifacts,
    ...succeededICs.flatMap((r) => r.artifacts),
  ];

  const summary = `QA strategy + ${succeededICs.length}/${icResults.length} IC agents completed. ${failedICs.length > 0 ? `Failed: ${failedICs.map((r) => r.role).join(", ")}` : ""}`;

  return {
    role: "qa-manager",
    status: failedICs.length > 0 ? "partial" : "completed",
    outputPath: strategyResult.outputPath,
    summary,
    artifacts: allArtifacts,
    tokenUsage: {
      input: Math.floor(totalTokens * 0.6),
      output: Math.floor(totalTokens * 0.4),
    },
    durationMs: strategyResult.durationMs + (icResults.length > 0 ? Math.max(...icResults.map((r) => r.durationMs)) : 0),
    error: failedICs.length > 0 ? `IC failures: ${failedICs.map((r) => r.role).join(", ")}` : undefined,
    icResults,
  };
}
