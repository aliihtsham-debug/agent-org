import type { AgentResult, ProjectPlan } from "../types/agent-types.js";
import { ROLE_OUTPUT_DIR } from "../types/agent-types.js";
import { writeOutput } from "../tools/file-tools.js";
import { runPMAgent } from "../agents/pm-agent.js";
import { runCTOAgent } from "../agents/cto-agent.js";
import { runCISOAgent } from "../agents/ciso-agent.js";
import { runCFOAgent } from "../agents/cfo-agent.js";
import { runCOOAgent } from "../agents/coo-agent.js";
import type { AgentContext } from "../agents/base-agent.js";
import { AgentLogger } from "../observability/logger.js";
import { buildBranchName, commitAgentArtifacts, pushBranchAndCreatePR } from "../tools/git-commit.js";

export interface CEOOptions {
  idea: string;
  apiKey: string;
  baseURL: string;
  outputBase: string;
  logger: AgentLogger;
  projectRoot: string;
}

export async function runCEOAgent(options: CEOOptions): Promise<ProjectPlan> {
  const { idea, apiKey, baseURL, outputBase, logger, projectRoot } = options;

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
    projectRoot,
    enableWebTools: true,
  };

  logger.info("CEO spawning 5 VPs in parallel: PM, CTO, CISO, CFO, COO…");

  // Spawn all 5 VPs in parallel
  const [pmResult, ctoResult, cisoResult, cfoResult, cooResult] = await Promise.all([
    runPMAgent(idea, ctx),
    runCTOAgent(idea, ctx),
    runCISOAgent(idea, ctx),
    runCFOAgent(idea, ctx),
    runCOOAgent(idea, ctx),
  ]);

  // Collect IC results from all VP branches (embedded by orchestrator agents)
  const icResults: AgentResult[] = [
    ...(pmResult.icResults ?? []),
    ...(ctoResult.icResults ?? []),
    ...(cisoResult.icResults ?? []),
    ...(cfoResult.icResults ?? []),
    ...(cooResult.icResults ?? []),
  ];

  // Fallback: verify each IC role's output exists on disk using shared ROLE_OUTPUT_DIR
  for (const ic of icResults) {
    const subdir = ROLE_OUTPUT_DIR[ic.role];
    const diskPath = `${outputBase}/${subdir}/${ic.role}/output.md`;
    if (!ic.artifacts.includes(diskPath)) {
      const content = await ctx.readArtifact(diskPath);
      if (content) {
        ic.artifacts.push(diskPath);
      }
    }
  }

  // Commit each agent's artifacts on role-specific branches
  const vpResults = [pmResult, ctoResult, cisoResult, cfoResult, cooResult];
  const agentsToCommit = [
    ...vpResults.map((r) => ({ role: r.role, artifacts: r.artifacts, summary: r.summary })),
    ...icResults.map((r) => ({ role: r.role, artifacts: r.artifacts, summary: r.summary })),
  ];

  for (const { role, artifacts, summary } of agentsToCommit) {
    const branch = buildBranchName(role, idea);
    commitAgentArtifacts({ projectRoot, branchName: branch, role, artifactPaths: artifacts, summary });
    logger.info(`${role} artifacts committed on branch ${branch}`);
    pushBranchAndCreatePR({ projectRoot, branchName: branch, role, summary });
  }

  // Determine overall status
  const gaps: string[] = [];
  const vpLabels: { result: AgentResult; label: string }[] = [
    { result: pmResult, label: "PM" },
    { result: ctoResult, label: "CTO" },
    { result: cisoResult, label: "CISO" },
    { result: cfoResult, label: "CFO" },
    { result: cooResult, label: "COO" },
  ];
  for (const { result, label } of vpLabels) {
    if (result.status === "failed") gaps.push(`${label} agent failed`);
    if (result.status === "partial") gaps.push(`${label} agent produced partial output`);
  }

  const allFailed = pmResult.status === "failed" && ctoResult.status === "failed" &&
    cisoResult.status === "failed" && cfoResult.status === "failed" && cooResult.status === "failed";
  const anyFailed = vpLabels.some(({ result }) => result.status === "failed");

  const plan: ProjectPlan = {
    idea,
    timestamp: new Date().toISOString(),
    pmResult,
    ctoResult,
    cisoResult,
    cfoResult,
    cooResult,
    icResults,
    status: allFailed ? "failed" : anyFailed || gaps.length > 0 ? "partial" : "complete",
    gaps,
  };

  // Write project plan
  await writePlan(plan, outputBase);

  // CEO summary output
  logger.banner(`CEO Summary — Status: ${plan.status.toUpperCase()}`);
  for (const { result, label } of vpLabels) {
    logger.info(`${label}: ${result.summary} (${result.status})`);
  }
  logger.info(`IC Agents: ${icResults.length} completed across all branches`);

  if (gaps.length > 0) {
    logger.info("Gaps requiring human review:");
    for (const gap of gaps) {
      logger.info(`  - ${gap}`);
    }
  }

  const totalTokens = vpResults.reduce(
    (sum, r) => sum + r.tokenUsage.input + r.tokenUsage.output,
    0,
  );

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
  const vpRows = (label: string, result: AgentResult) =>
    `| ${label} | ${result.status} | ${result.summary} | ${result.artifacts.join(", ") || "none"} |`;

  const md = `# Project Plan: ${plan.idea}

**Generated:** ${plan.timestamp}
**Status:** ${plan.status}
**Overall:** ${plan.gaps.length > 0 ? plan.gaps.join("; ") : "All agents completed successfully"}

---

## Executive Summary

| VP Branch | Status | Summary | Artifacts |
|-----------|--------|---------|-----------|
${vpRows("PM", plan.pmResult)}
${vpRows("CTO", plan.ctoResult)}
${vpRows("CISO", plan.cisoResult)}
${vpRows("CFO", plan.cfoResult)}
${vpRows("COO", plan.cooResult)}

## Engineering Delivery (All IC Agents)

| Agent | Status | Summary |
|-------|--------|---------|
${plan.icResults.map((r) => `| ${r.role} | ${r.status} | ${r.summary} |`).join("\n") || "| — | — | No IC results |"}

## Token Usage

| Agent | Input | Output |
|-------|-------|--------|
| PM | ${plan.pmResult.tokenUsage.input.toLocaleString()} | ${plan.pmResult.tokenUsage.output.toLocaleString()} |
| CTO | ${plan.ctoResult.tokenUsage.input.toLocaleString()} | ${plan.ctoResult.tokenUsage.output.toLocaleString()} |
| CISO | ${plan.cisoResult.tokenUsage.input.toLocaleString()} | ${plan.cisoResult.tokenUsage.output.toLocaleString()} |
| CFO | ${plan.cfoResult.tokenUsage.input.toLocaleString()} | ${plan.cfoResult.tokenUsage.output.toLocaleString()} |
| COO | ${plan.cooResult.tokenUsage.input.toLocaleString()} | ${plan.cooResult.tokenUsage.output.toLocaleString()} |
${plan.icResults.map((r) => `| ${r.role} | ${r.tokenUsage.input.toLocaleString()} | ${r.tokenUsage.output.toLocaleString()} |`).join("\n")}
| **Total (VPs)** | **${(plan.pmResult.tokenUsage.input + plan.ctoResult.tokenUsage.input + plan.cisoResult.tokenUsage.input + plan.cfoResult.tokenUsage.input + plan.cooResult.tokenUsage.input).toLocaleString()}** | **${(plan.pmResult.tokenUsage.output + plan.ctoResult.tokenUsage.output + plan.cisoResult.tokenUsage.output + plan.cfoResult.tokenUsage.output + plan.cooResult.tokenUsage.output).toLocaleString()}** |

---

*Generated by Agent Org v0.3.0*
`;

  await writeOutput(`${outputBase}/project-plan.md`, md);
}
