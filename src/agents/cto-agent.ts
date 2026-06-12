import type { AgentResult } from "../types/agent-types.js";
import { runAgentWithRetry, type AgentContext } from "./base-agent.js";
import { runAllICAgents } from "./ic-agents.js";

export async function runCTOAgent(
  idea: string,
  ctx: AgentContext,
): Promise<AgentResult> {
  // Step 1: CTO produces architecture
  const archSpec = {
    id: `cto-arch-${Date.now()}`,
    role: "cto" as const,
    task: `Create an Architecture Decision Record (ADR) and system design for: "${idea}"`,
    context: "",
    outputPath: `${ctx.outputBase}/architecture/cto`,
  };

  const archResult = await runAgentWithRetry(archSpec, ctx);

  if (archResult.status === "failed") {
    return archResult;
  }

  // Step 2: Read the architecture output for context
  const archContent = await ctx.readArtifact(
    `${archResult.outputPath}/output.md`,
  );
  const archSummary = archContent?.slice(0, 2000) ?? archResult.summary;

  // Step 3: Spawn all IC agents in parallel with architecture context
  // IC agents don't need web tools — they get architecture + product context
  const icCtx: AgentContext = { ...ctx, parentRole: "cto", enableWebTools: false };
  const icResults = await runAllICAgents(
    idea,
    icCtx,
    archSummary,
    "", // PM hasn't run yet at this point — CEO merges results
  );

  // Step 4: Aggregate IC results into a unified technical summary
  const failedICs = icResults.filter((r) => r.status === "failed");
  const succeededICs = icResults.filter((r) => r.status === "completed");

  const totalTokens = icResults.reduce(
    (sum, r) => sum + r.tokenUsage.input + r.tokenUsage.output,
    archResult.tokenUsage.input + archResult.tokenUsage.output,
  );

  const allArtifacts = [
    ...archResult.artifacts,
    ...succeededICs.flatMap((r) => r.artifacts),
  ];

  const summary = `Architecture + ${succeededICs.length}/5 IC agents completed. ${failedICs.length > 0 ? `Failed: ${failedICs.map((r) => r.role).join(", ")}` : ""}`;

  return {
    role: "cto",
    status: failedICs.length > 0 ? "partial" : "completed",
    outputPath: archResult.outputPath,
    summary,
    artifacts: allArtifacts,
    tokenUsage: {
      input: Math.floor(totalTokens * 0.6),
      output: Math.floor(totalTokens * 0.4),
    },
    durationMs: archResult.durationMs + Math.max(...icResults.map((r) => r.durationMs)),
    error: failedICs.length > 0 ? `IC failures: ${failedICs.map((r) => r.role).join(", ")}` : undefined,
  };
}
