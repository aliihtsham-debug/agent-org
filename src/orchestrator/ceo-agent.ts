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
import { AgentEventEmitter } from "../observability/events.js";
import { createStructuredLogHandlers } from "../observability/structured-log.js";
import { promptApproval } from "../observability/approval.js";
import { buildBranchName, commitAgentArtifacts, pushBranchAndCreatePR } from "../tools/git-commit.js";
import { broadcastEvent, updateStatus } from "../dashboard/server.js";

export interface CEOOptions {
  idea: string;
  apiKey: string;
  baseURL: string;
  outputBase: string;
  logger: AgentLogger;
  projectRoot: string;
  /** Whether to pause at milestone gates for human approval */
  enableApproval?: boolean;
}

export async function runCEOAgent(options: CEOOptions): Promise<ProjectPlan> {
  const { idea, apiKey, baseURL, outputBase, logger, projectRoot, enableApproval = false } = options;

  logger.banner(`Agent Org — Product Idea: "${idea}"`);

  // ── Set up event emitter + structured logging ──
  const emitter = new AgentEventEmitter();
  logger.setEmitter(emitter);
  const { onEvent, onArtifact } = createStructuredLogHandlers(outputBase);
  emitter.subscribe(onEvent);
  emitter.subscribe((event) => broadcastEvent(event));
  updateStatus("running");

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

  // ── GATE 1: Review VP outputs before committing ──
  const vpResults = [pmResult, ctoResult, cisoResult, cfoResult, cooResult];
  const succeededVPs = vpResults.filter((r) => r.status === "completed" || r.status === "partial");
  const failedVPs = vpResults.filter((r) => r.status === "failed");

  if (enableApproval) {
    emitter.emit({
      type: "gate",
      timestamp: new Date().toISOString(),
      summary: `VP outputs ready: ${succeededVPs.length} succeeded, ${failedVPs.length} failed`,
    });
    const approved = await promptApproval(
      `VP outputs ready — ${succeededVPs.length} succeeded, ${failedVPs.length} failed. Proceed with git commit?`,
    );
    if (!approved) {
      logger.info("User skipped git commit. Building plan without commits.");
      return await buildPlan(idea, outputBase, vpResults, icResults, logger, projectRoot, onArtifact);
    }
  }

  // Commit each agent's artifacts on role-specific branches
  const agentsToCommit = [
    ...vpResults.map((r) => ({ role: r.role, artifacts: r.artifacts, summary: r.summary, result: r })),
    ...icResults.map((r) => ({ role: r.role, artifacts: r.artifacts, summary: r.summary, result: r })),
  ];

  for (const { role, artifacts, summary, result } of agentsToCommit) {
    const branch = buildBranchName(role, idea);
    commitAgentArtifacts({ projectRoot, branchName: branch, role, artifactPaths: artifacts, summary });
    logger.info(`${role} artifacts committed on branch ${branch}`);
    onArtifact(result, projectRoot);
    pushBranchAndCreatePR({ projectRoot, branchName: branch, role, summary });
  }

  return await buildPlan(idea, outputBase, vpResults, icResults, logger, projectRoot, onArtifact);
}

async function buildPlan(
  idea: string,
  outputBase: string,
  vpResults: AgentResult[],
  icResults: AgentResult[],
  logger: AgentLogger,
  projectRoot: string,
  onArtifact: (result: AgentResult, projectRoot: string) => void,
): Promise<ProjectPlan> {
  // Determine overall status
  const gaps: string[] = [];
  const vpLabels: { result: AgentResult; label: string }[] = [
    { result: vpResults[0], label: "PM" },
    { result: vpResults[1], label: "CTO" },
    { result: vpResults[2], label: "CISO" },
    { result: vpResults[3], label: "CFO" },
    { result: vpResults[4], label: "COO" },
  ];
  for (const { result, label } of vpLabels) {
    if (result.status === "failed") gaps.push(`${label} agent failed`);
    if (result.status === "partial") gaps.push(`${label} agent produced partial output`);
  }

  const allFailed = vpResults.every((r) => r.status === "failed");
  const anyFailed = vpResults.some((r) => r.status === "failed");

  const pmResult = vpResults[0];
  const ctoResult = vpResults[1];
  const cisoResult = vpResults[2];
  const cfoResult = vpResults[3];
  const cooResult = vpResults[4];

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

  updateStatus(plan.status === "failed" ? "failed" : "complete");

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

*Generated by Agent Org v0.4.0*
`;

  await writeOutput(`${outputBase}/project-plan.md`, md);
}
