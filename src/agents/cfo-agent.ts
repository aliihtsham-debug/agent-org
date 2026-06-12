import type { AgentResult } from "../types/agent-types.js";
import { runAgentWithRetry, type AgentContext } from "./base-agent.js";
import { runFinanceICs } from "./ic-agents.js";

export async function runCFOAgent(
  idea: string,
  ctx: AgentContext,
): Promise<AgentResult> {
  // Step 1: Produce financial overview
  const overviewSpec = {
    id: `cfo-overview-${Date.now()}`,
    role: "cfo" as const,
    task: `Create a financial overview for: "${idea}"`,
    context: "",
    outputPath: `${ctx.outputBase}/finance/cfo`,
  };

  const overviewResult = await runAgentWithRetry(overviewSpec, ctx);

  if (overviewResult.status === "failed") {
    return overviewResult;
  }

  // Step 2: Publish and read overview from registry (no disk round-trip, no truncation)
  ctx.resultsRegistry.publish(overviewResult);
  const overviewSummary = ctx.resultsRegistry.getSummary("cfo") ?? overviewResult.summary;

  // Step 3: Spawn budget + pricing ICs in parallel
  const icCtx: AgentContext = { ...ctx, parentRole: "cfo", enableWebTools: false };
  const icResults = await runFinanceICs(idea, icCtx, overviewSummary);

  // Step 4: Aggregate IC results
  const failedICs = icResults.filter((r) => r.status === "failed");
  const succeededICs = icResults.filter((r) => r.status === "completed");

  const totalTokens = icResults.reduce(
    (sum, r) => sum + r.tokenUsage.input + r.tokenUsage.output,
    overviewResult.tokenUsage.input + overviewResult.tokenUsage.output,
  );

  const allArtifacts = [
    ...overviewResult.artifacts,
    ...succeededICs.flatMap((r) => r.artifacts),
  ];

  const summary = `Financial overview + ${succeededICs.length}/${icResults.length} IC agents completed. ${failedICs.length > 0 ? `Failed: ${failedICs.map((r) => r.role).join(", ")}` : ""}`;

  return {
    role: "cfo",
    status: failedICs.length > 0 ? "partial" : "completed",
    outputPath: overviewResult.outputPath,
    summary,
    artifacts: allArtifacts,
    tokenUsage: {
      input: Math.floor(totalTokens * 0.6),
      output: Math.floor(totalTokens * 0.4),
    },
    durationMs: overviewResult.durationMs + Math.max(...icResults.map((r) => r.durationMs)),
    error: failedICs.length > 0 ? `IC failures: ${failedICs.map((r) => r.role).join(", ")}` : undefined,
    icResults,
  };
}
