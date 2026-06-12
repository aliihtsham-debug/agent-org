import type { AgentResult } from "../types/agent-types.js";
import { runAgentWithRetry, type AgentContext } from "./base-agent.js";
import { runOperationsICs } from "./ic-agents.js";

export async function runCOOAgent(
  idea: string,
  ctx: AgentContext,
): Promise<AgentResult> {
  // Step 1: Produce operations plan
  const planSpec = {
    id: `coo-plan-${Date.now()}`,
    role: "coo" as const,
    task: `Create an operations plan for: "${idea}"`,
    context: "",
    outputPath: `${ctx.outputBase}/operations/coo`,
  };

  const planResult = await runAgentWithRetry(planSpec, ctx);

  if (planResult.status === "failed") {
    return planResult;
  }

  // Step 2: Publish and read plan from registry (no disk round-trip, no truncation)
  ctx.resultsRegistry.publish(planResult);
  const planSummary = ctx.resultsRegistry.getSummary("coo") ?? planResult.summary;

  // Step 3: Spawn operations ICs in parallel
  const icCtx: AgentContext = { ...ctx, parentRole: "coo", enableWebTools: false };
  const icResults = await runOperationsICs(idea, icCtx, planSummary);

  // Step 4: Aggregate IC results
  const failedICs = icResults.filter((r) => r.status === "failed");
  const succeededICs = icResults.filter((r) => r.status === "completed");

  const totalTokens = icResults.reduce(
    (sum, r) => sum + r.tokenUsage.input + r.tokenUsage.output,
    planResult.tokenUsage.input + planResult.tokenUsage.output,
  );

  const allArtifacts = [
    ...planResult.artifacts,
    ...succeededICs.flatMap((r) => r.artifacts),
  ];

  const summary = `Operations plan + ${succeededICs.length}/${icResults.length} IC agents completed. ${failedICs.length > 0 ? `Failed: ${failedICs.map((r) => r.role).join(", ")}` : ""}`;

  return {
    role: "coo",
    status: failedICs.length > 0 ? "partial" : "completed",
    outputPath: planResult.outputPath,
    summary,
    artifacts: allArtifacts,
    tokenUsage: {
      input: Math.floor(totalTokens * 0.6),
      output: Math.floor(totalTokens * 0.4),
    },
    durationMs: planResult.durationMs + Math.max(...icResults.map((r) => r.durationMs)),
    error: failedICs.length > 0 ? `IC failures: ${failedICs.map((r) => r.role).join(", ")}` : undefined,
    icResults,
  };
}
