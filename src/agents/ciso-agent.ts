import type { AgentResult } from "../types/agent-types.js";
import { runAgentWithRetry, type AgentContext } from "./base-agent.js";
import { runSecurityICs } from "./ic-agents.js";

export async function runCISOAgent(
  idea: string,
  ctx: AgentContext,
): Promise<AgentResult> {
  // Step 1: Produce security strategy
  const strategySpec = {
    id: `ciso-strategy-${Date.now()}`,
    role: "ciso" as const,
    task: `Create a security strategy for: "${idea}"`,
    context: "",
    outputPath: `${ctx.outputBase}/security/ciso`,
  };

  const strategyResult = await runAgentWithRetry(strategySpec, ctx);

  if (strategyResult.status === "failed") {
    return strategyResult;
  }

  // Step 2: Publish and read strategy from registry (no disk round-trip, no truncation)
  ctx.resultsRegistry.publish(strategyResult);
  const strategySummary = ctx.resultsRegistry.getSummary("ciso") ?? strategyResult.summary;

  // Step 3: Spawn security ICs in parallel
  const icCtx: AgentContext = { ...ctx, parentRole: "ciso", enableWebTools: false };
  const icResults = await runSecurityICs(idea, icCtx, strategySummary);

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

  const summary = `Security strategy + ${succeededICs.length}/${icResults.length} IC agents completed. ${failedICs.length > 0 ? `Failed: ${failedICs.map((r) => r.role).join(", ")}` : ""}`;

  return {
    role: "ciso",
    status: failedICs.length > 0 ? "partial" : "completed",
    outputPath: strategyResult.outputPath,
    summary,
    artifacts: allArtifacts,
    tokenUsage: {
      input: Math.floor(totalTokens * 0.6),
      output: Math.floor(totalTokens * 0.4),
    },
    durationMs: strategyResult.durationMs + Math.max(...icResults.map((r) => r.durationMs)),
    error: failedICs.length > 0 ? `IC failures: ${failedICs.map((r) => r.role).join(", ")}` : undefined,
    icResults,
  };
}
