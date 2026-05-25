import type { AgentResult } from "../types/agent-types.js";
import { runAgentWithRetry, type AgentContext } from "./base-agent.js";

export async function runPMAgent(
  idea: string,
  ctx: AgentContext,
): Promise<AgentResult> {
  const spec = {
    id: `pm-${Date.now()}`,
    role: "pm" as const,
    task: `Create a Product Requirements Document (PRD) for: "${idea}"`,
    context: "",
    outputPath: `${ctx.outputBase}/specs/pm`,
  };

  return runAgentWithRetry(spec, ctx);
}
