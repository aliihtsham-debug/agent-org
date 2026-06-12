import type { AgentResult } from "../types/agent-types.js";
import { runAgentWithRetry, type AgentContext } from "./base-agent.js";
import { runPMICs } from "./ic-agents.js";

export async function runPMAgent(
  idea: string,
  ctx: AgentContext,
): Promise<AgentResult> {
  // Step 1: Produce product strategy overview
  const overviewSpec = {
    id: `pm-overview-${Date.now()}`,
    role: "pm" as const,
    task: `Create a product strategy summary for: "${idea}"`,
    context: "",
    outputPath: `${ctx.outputBase}/specs/pm`,
  };

  const overviewResult = await runAgentWithRetry(overviewSpec, ctx);

  if (overviewResult.status === "failed") {
    return overviewResult;
  }

  // Step 2: Read the overview for context
  const overviewContent = await ctx.readArtifact(
    `${overviewResult.outputPath}/output.md`,
  );
  const overviewSummary = overviewContent?.slice(0, 2000) ?? overviewResult.summary;

  // Step 3: Spawn UX Researcher, Roadmap Agent, and Analytics Agent in parallel
  const icCtx: AgentContext = { ...ctx, parentRole: "pm", enableWebTools: false };
  const icResults = await runPMICs(idea, icCtx, overviewSummary);

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

  const summary = `Product strategy + ${succeededICs.length}/${icResults.length} IC agents completed. ${failedICs.length > 0 ? `Failed: ${failedICs.map((r) => r.role).join(", ")}` : ""}`;

  return {
    role: "pm",
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
