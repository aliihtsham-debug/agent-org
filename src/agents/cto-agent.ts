import type { AgentResult } from "../types/agent-types.js";
import { runAgentWithRetry, type AgentContext } from "./base-agent.js";
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

  // Step 2: Publish and read architecture from registry (no disk round-trip, no truncation)
  ctx.resultsRegistry.publish(archResult);
  const archSummary = ctx.resultsRegistry.getSummary("cto") ?? archResult.summary;

  // Step 3: Spawn Engineering Manager + QA Manager in parallel
  const mgrCtx: AgentContext = { ...ctx, parentRole: "cto", enableWebTools: false };
  const [engMgrResult, qaMgrResult] = await Promise.all([
    runEngManagerAgent(idea, mgrCtx, archSummary, ""),
    runQAManagerAgent(idea, mgrCtx, archSummary, ""),
  ]);

  // Step 4: Collect IC results from both managers
  const icResults: AgentResult[] = [
    ...(engMgrResult.icResults ?? []),
    ...(qaMgrResult.icResults ?? []),
  ];

  const failedICs = icResults.filter((r) => r.status === "failed");
  const succeededICs = icResults.filter((r) => r.status === "completed");
  const managerFailed = engMgrResult.status === "failed" || qaMgrResult.status === "failed";

  const totalTokens =
    archResult.tokenUsage.input + archResult.tokenUsage.output +
    engMgrResult.tokenUsage.input + engMgrResult.tokenUsage.output +
    qaMgrResult.tokenUsage.input + qaMgrResult.tokenUsage.output;

  const allArtifacts = [
    ...archResult.artifacts,
    ...engMgrResult.artifacts,
    ...qaMgrResult.artifacts,
    ...succeededICs.flatMap((r) => r.artifacts),
  ];

  const summary = `Architecture + ${succeededICs.length}/${icResults.length} IC agents completed via 2 managers. ${failedICs.length > 0 ? `Failed: ${failedICs.map((r) => r.role).join(", ")}` : ""}`;

  return {
    role: "cto",
    status: managerFailed || failedICs.length > 0 ? "partial" : "completed",
    outputPath: archResult.outputPath,
    summary,
    artifacts: allArtifacts,
    tokenUsage: {
      input: Math.floor(totalTokens * 0.6),
      output: Math.floor(totalTokens * 0.4),
    },
    durationMs: archResult.durationMs + Math.max(engMgrResult.durationMs, qaMgrResult.durationMs),
    error: failedICs.length > 0 ? `IC failures: ${failedICs.map((r) => r.role).join(", ")}` : undefined,
    icResults,
  };
}
