import type { AgentResult, ProjectPlan } from "../types/agent-types.js";
import { writeOutput } from "../tools/file-tools.js";
import { runPMAgent } from "../agents/pm-agent.js";
import { runCTOAgent } from "../agents/cto-agent.js";
import type { AgentContext } from "../agents/base-agent.js";
import { AgentLogger } from "../observability/logger.js";

export interface CEOOptions {
  idea: string;
  apiKey: string;
  baseURL: string;
  outputBase: string;
  logger: AgentLogger;
}

export async function runCEOAgent(options: CEOOptions): Promise<ProjectPlan> {
  const { idea, apiKey, baseURL, outputBase, logger } = options;

  logger.banner(`Agent Org — Product Idea: "${idea}"`);

  const ctx: AgentContext = {
    apiKey,
    baseURL,
    outputBase,
    logger,
    parentRole: "ceo",
    readArtifact: async (path: string) => {
      const { readFileIfExists } = await import("../tools/file-tools.js");
      return readFileIfExists(path);
    },
  };

  logger.info("CEO spawning PM + CTO in parallel…");

  // Spawn PM and CTO in parallel
  const [pmResult, ctoResult] = await Promise.all([
    runPMAgent(idea, ctx),
    runCTOAgent(idea, ctx),
  ]);

  // Collect IC results from CTO's run
  const icResults: AgentResult[] = [];

  // IC agents run inside CTO — check the output dirs for their results
  const icRoles = [
    "frontend-engineer",
    "backend-engineer",
    "testing-agent",
    "security-auditor",
    "devops-agent",
  ] as const;

  for (const role of icRoles) {
    const subdir =
      role === "frontend-engineer" ? "code/frontend"
      : role === "backend-engineer" ? "code/backend"
      : role === "devops-agent" ? "code/devops"
      : role === "testing-agent" ? "tests"
      : "security";

    const outputPath = `${outputBase}/${subdir}/${role}/output.md`;
    const content = await ctx.readArtifact(outputPath);
    if (content) {
      icResults.push({
        role,
        status: "completed",
        outputPath: `${outputBase}/${subdir}/${role}`,
        summary: `${role} scaffold written`,
        artifacts: [outputPath],
        tokenUsage: { input: 0, output: 0 },
        durationMs: 0,
      });
    }
  }

  // Determine overall status
  const gaps: string[] = [];
  if (pmResult.status === "failed") gaps.push("PM agent failed — no PRD produced");
  if (ctoResult.status === "failed") gaps.push("CTO agent failed — no architecture produced");
  if (pmResult.status === "partial") gaps.push("PM agent produced partial output");
  if (ctoResult.status === "partial") gaps.push("CTO agent produced partial output");

  const allFailed = pmResult.status === "failed" && ctoResult.status === "failed";
  const anyFailed = pmResult.status === "failed" || ctoResult.status === "failed";

  const plan: ProjectPlan = {
    idea,
    timestamp: new Date().toISOString(),
    pmResult,
    ctoResult,
    icResults,
    status: allFailed ? "failed" : anyFailed || gaps.length > 0 ? "partial" : "complete",
    gaps,
  };

  // Write project plan
  await writePlan(plan, outputBase);

  // CEO summary output
  logger.banner(`CEO Summary — Status: ${plan.status.toUpperCase()}`);
  logger.info(`PM: ${pmResult.summary} (${pmResult.status})`);
  logger.info(`CTO: ${ctoResult.summary} (${ctoResult.status})`);
  logger.info(`IC Agents: ${icResults.length}/${icRoles.length} completed`);

  if (gaps.length > 0) {
    logger.info("Gaps requiring human review:");
    for (const gap of gaps) {
      logger.info(`  - ${gap}`);
    }
  }

  const totalTokens =
    pmResult.tokenUsage.input + pmResult.tokenUsage.output +
    ctoResult.tokenUsage.input + ctoResult.tokenUsage.output;

  logger.info(`Total tokens: ~${totalTokens.toLocaleString()} (input+output)`);
  logger.info(`Total duration: ${(logger.getDuration() / 1000).toFixed(1)}s`);
  logger.info(`Outputs written to: ${outputBase}/`);

  return plan;
}

async function writePlan(plan: ProjectPlan, outputBase: string): Promise<void> {
  // JSON plan for programmatic consumption
  await writeOutput(
    `${outputBase}/project-plan.json`,
    JSON.stringify(plan, null, 2),
  );

  // Markdown plan for human reading
  const md = `# Project Plan: ${plan.idea}

**Generated:** ${plan.timestamp}
**Status:** ${plan.status}
**Overall:** ${plan.gaps.length > 0 ? plan.gaps.join("; ") : "All agents completed successfully"}

---

## Product Management

**Summary:** ${plan.pmResult.summary}
**Status:** ${plan.pmResult.status}
**Artifacts:** ${plan.pmResult.artifacts.join(", ") || "none"}

## Technical Architecture

**Summary:** ${plan.ctoResult.summary}
**Status:** ${plan.ctoResult.status}
**Artifacts:** ${plan.ctoResult.artifacts.join(", ") || "none"}

## Engineering Delivery

| Agent | Status | Summary |
|-------|--------|---------|
${plan.icResults.map((r) => `| ${r.role} | ${r.status} | ${r.summary} |`).join("\n")}

## Token Usage

| Agent | Input | Output |
|-------|-------|--------|
| PM | ${plan.pmResult.tokenUsage.input.toLocaleString()} | ${plan.pmResult.tokenUsage.output.toLocaleString()} |
| CTO | ${plan.ctoResult.tokenUsage.input.toLocaleString()} | ${plan.ctoResult.tokenUsage.output.toLocaleString()} |
${plan.icResults.map((r) => `| ${r.role} | ${r.tokenUsage.input.toLocaleString()} | ${r.tokenUsage.output.toLocaleString()} |`).join("\n")}
| **Total** | **${(plan.pmResult.tokenUsage.input + plan.ctoResult.tokenUsage.input).toLocaleString()}** | **${(plan.pmResult.tokenUsage.output + plan.ctoResult.tokenUsage.output).toLocaleString()}** |

---

*Generated by Agent Org v0.1.0*
`;

  await writeOutput(`${outputBase}/project-plan.md`, md);
}
