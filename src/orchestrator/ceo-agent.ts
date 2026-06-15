import type { AgentResult, ProjectPlan, RefinementConfig, RefinementReport, LinearSyncResult } from "../types/agent-types.js";
import { ROLE_OUTPUT_DIR } from "../types/agent-types.js";
import { writeOutput } from "../tools/file-tools.js";
import { resolve, sep } from "node:path";
import { runPMAgent } from "../agents/pm-agent.js";
import { runCTOAgent } from "../agents/cto-agent.js";
import { runCISOAgent } from "../agents/ciso-agent.js";
import { runCFOAgent } from "../agents/cfo-agent.js";
import { runCOOAgent } from "../agents/coo-agent.js";
import type { AgentContext } from "../agents/base-agent.js";
import { AgentLogger } from "../observability/logger.js";
import { AgentEventEmitter, generateEventId, generateRunId } from "../observability/events.js";
import { createStructuredLogHandlers } from "../observability/structured-log.js";
import { promptApproval } from "../observability/approval.js";
import { buildBranchName, commitAgentArtifacts, pushBranchAndCreatePR } from "../tools/git-commit.js";
import { broadcastEvent, updateStatus } from "../dashboard/server.js";
import { AgentResultsRegistry } from "../communication/results-registry.js";
import { AgentMessageBus } from "../communication/message-bus.js";
import { runRefinementPhase, writeRefinementSummary } from "../refinement/refinement-phase.js";
import { DEFAULT_REVIEW_PAIRS } from "../refinement/review-pairs.js";
import { gatherWebResearch } from "../agents/base-agent.js";
// Phase 10 — Audit
import { AuditLog } from "../audit/audit-log.js";
import { ProvenanceTracker } from "../audit/provenance-tracker.js";
// Phase 9 — Governance
import { PolicyEngine } from "../governance/policy-engine.js";
import { DEFAULT_POLICY } from "../governance/policy-templates.js";
import { assessRisk } from "../governance/risk-assessment.js";
// Phase 11 — Human-in-the-Loop
import { ApprovalWorkflow } from "../approval/approval-workflow.js";
import { evaluateEscalation } from "../approval/risk-escalation.js";

export interface CEOOptions {
  idea: string;
  apiKey: string;
  baseURL: string;
  outputBase: string;
  logger: AgentLogger;
  projectRoot: string;
  /** Whether to pause at milestone gates for human approval */
  enableApproval?: boolean;
  /** Phase 6 — Enable cross-functional iterative refinement */
  enableRefinement?: boolean;
  /** Phase 6 — Refinement configuration (uses defaults if not provided) */
  refinementConfig?: RefinementConfig;
  /** Phase 7 — Linear API key for project sync (optional) */
  linearApiKey?: string;
  /** Phase 8 — Enable cryptographic identity for agents */
  enableIdentity?: boolean;
  /** Phase 9 — Enable governance policy engine */
  enableGovernance?: boolean;
  /** Phase 10 — Enable hash-chained audit logging */
  enableAudit?: boolean;
  /** Phase 13 — Enable security platform (TEE, secrets, zero-trust) */
  enableSecurity?: boolean;
}

export async function runCEOAgent(options: CEOOptions): Promise<ProjectPlan> {
  const { idea, apiKey, baseURL, outputBase, logger, projectRoot, enableApproval = false, enableRefinement = false, linearApiKey, enableIdentity = false, enableGovernance = false, enableAudit = false, enableSecurity = false } = options;

  logger.banner(`Agent Org — Product Idea: "${idea}"`);

  // ── Generate run ID for correlation (Phase 12) ──
  const runId = generateRunId();
  logger.setRunId(runId);

  // ── Phase 10: Initialize audit log + provenance tracker ──
  const auditLog = enableAudit ? new AuditLog() : null;
  const provenance = enableAudit ? new ProvenanceTracker() : null;
  if (enableAudit && provenance) {
    provenance.trackDecision(runId, idea);
  }

  // ── Phase 9: Initialize governance policy engine ──
  const policyEngine = enableGovernance ? new PolicyEngine() : null;
  if (policyEngine) {
    DEFAULT_POLICY.forEach((rule) => policyEngine.addRule(rule));
  }

  // ── Phase 11: Initialize approval workflow ──
  const approvalWorkflow = enableApproval ? new ApprovalWorkflow() : null;

  // ── Set up event emitter + structured logging ──
  const emitter = new AgentEventEmitter();
  logger.setEmitter(emitter);
  const { onEvent, onArtifact } = createStructuredLogHandlers(outputBase);
  emitter.subscribe(onEvent);
  emitter.subscribe((event) => broadcastEvent(event));
  updateStatus("running");

  // ── Set up direct agent-to-agent communication ──
  const registry = new AgentResultsRegistry();
  const messageBus = new AgentMessageBus();

  const ctx: AgentContext = {
    apiKey,
    baseURL,
    outputBase,
    logger,
    parentRole: "ceo",
    runId,
    readArtifact: async (path: string) => {
      // Path confinement: only allow reads within the outputBase directory
      try {
        const allowedRoot = resolve(outputBase);
        const resolved = resolve(path);
        if (!resolved.startsWith(allowedRoot + sep) && resolved !== allowedRoot) {
          logger.info(`readArtifact blocked: path "${path}" is outside outputBase`);
          return null;
        }
      } catch {
        return null; // Malformed path
      }
      const { readFileIfExists } = await import("../tools/file-tools.js");
      return readFileIfExists(path);
    },
    projectRoot,
    enableWebTools: true,
    resultsRegistry: registry,
    messageBus: messageBus,
  };

  // Gather web research ONCE at CEO level, then share across all agents to avoid
  // 5 redundant DuckDuckGo API calls (one per VP). Each ~500ms, so this saves ~2s.
  const webResearchContext = ctx.enableWebTools ? await gatherWebResearch(idea) : "";
  if (webResearchContext) {
    logger.info("CEO gathered web research — sharing context with all agents");
  }
  ctx.webResearchContext = webResearchContext;

  // ── Phase 9: Governance — evaluate risk before spawning VPs ──
  if (policyEngine) {
    const risk = assessRisk("spawn", "medium");
    const govCtx = {
      riskLevel: risk,
      delegationDepth: 0,
      timestamp: new Date().toISOString(),
    };
    const decision = policyEngine.evaluate("ceo", "spawn", govCtx);
    logger.info(`Governance evaluation: ${decision.effect} (risk: ${risk}, policy: ${decision.ruleId ?? "none"})`);
    if (decision.effect === "deny") {
      logger.info("Governance policy denied VP spawning — aborting");
      updateStatus("failed");
      return {
        idea,
        timestamp: new Date().toISOString(),
        pmResult: { role: "pm", status: "failed", outputPath: "", summary: "Blocked by governance policy", artifacts: [], tokenUsage: { input: 0, output: 0 }, durationMs: 0, error: "Governance deny" },
        ctoResult: { role: "cto", status: "failed", outputPath: "", summary: "Blocked by governance policy", artifacts: [], tokenUsage: { input: 0, output: 0 }, durationMs: 0, error: "Governance deny" },
        cisoResult: { role: "ciso", status: "failed", outputPath: "", summary: "Blocked by governance policy", artifacts: [], tokenUsage: { input: 0, output: 0 }, durationMs: 0, error: "Governance deny" },
        cfoResult: { role: "cfo", status: "failed", outputPath: "", summary: "Blocked by governance policy", artifacts: [], tokenUsage: { input: 0, output: 0 }, durationMs: 0, error: "Governance deny" },
        cooResult: { role: "coo", status: "failed", outputPath: "", summary: "Blocked by governance policy", artifacts: [], tokenUsage: { input: 0, output: 0 }, durationMs: 0, error: "Governance deny" },
        icResults: [],
        status: "failed",
        gaps: ["Governance policy denied VP spawning"],
      };
    }
    // Record policy evaluation to audit
    if (auditLog) {
      await auditLog.appendEntry({
        agentDid: "did:agent:ceo",
        action: "policy_eval",
        inputHash: `risk:${risk}`,
        outputHash: `decision:${decision.decision}`,
        inputRef: "governance-eval",
        outputRef: "governance-decision",
        timestamp: new Date().toISOString(),
        eventId: `audit-${generateEventId()}`,
        signature: "",
      });
    }
  }

  // ── Phase 10: Audit — record CEO decision delegation ──
  if (auditLog) {
    await auditLog.appendEntry({
      agentDid: "did:agent:ceo",
      action: "agent_spawn",
      inputHash: idea.slice(0, 64),
      outputHash: "vps-spawned",
      inputRef: idea,
      outputRef: "outputs/ceo",
      timestamp: new Date().toISOString(),
      eventId: `audit-${generateEventId()}`,
      signature: "",
    });
  }
  if (provenance) {
    provenance.trackDecision(runId, idea);
  }

  logger.info("CEO spawning 5 VPs in parallel: PM, CTO, CISO, CFO, COO…");

  // Use Promise.allSettled so one VP throwing doesn't kill the whole orchestration.
  // Each settled result is normalized to a typed AgentResult with "failed" status.
  const vpLabels = ["pm", "cto", "ciso", "cfo", "coo"] as const;
  const settled = await Promise.allSettled([
    runPMAgent(idea, ctx),
    runCTOAgent(idea, ctx),
    runCISOAgent(idea, ctx),
    runCFOAgent(idea, ctx),
    runCOOAgent(idea, ctx),
  ]);

  const vpResults: AgentResult[] = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    const label = vpLabels[i];
    const error = s.reason instanceof Error ? s.reason.message : String(s.reason);
    logger.info(`VP ${label} threw unexpectedly: ${error}`);
    return {
      role: label,
      status: "failed" as const,
      outputPath: `${outputBase}/error`,
      summary: `VP ${label} failed: ${error}`,
      artifacts: [],
      tokenUsage: { input: 0, output: 0 },
      durationMs: 0,
      error,
    } satisfies AgentResult;
  });

  const [pmResult, ctoResult, cisoResult, cfoResult, cooResult] = vpResults;

  // ── Phase 10: Audit — record VP completions/failures ──
  if (auditLog) {
    for (const vp of vpResults) {
      await auditLog.appendEntry({
        agentDid: `did:agent:${vp.role}`,
        action: vp.status === "failed" ? "agent_fail" : "agent_complete",
        inputHash: idea.slice(0, 64),
        outputHash: vp.summary.slice(0, 64),
        inputRef: idea,
        outputRef: vp.outputPath,
        timestamp: new Date().toISOString(),
        eventId: `audit-${generateEventId()}`,
        signature: "",
      });
    }
  }

  // ── Phase 10: Provenance — track VP delegations ──
  if (provenance) {
    for (const vp of vpResults) {
      provenance.trackDelegation("ceo", vp.role, "spawn", idea);
      if (vp.status === "completed" || vp.status === "partial") {
        provenance.trackOutput(vp.role, vp.outputPath, [idea]);
      }
    }
  }

  // ── Phase 11: Risk escalation check on VP failures ──
  if (approvalWorkflow && enableApproval) {
    const escalation = evaluateEscalation(vpResults, "medium", [
      { trigger: "reject", escalateTo: "ceo", notifyChannels: ["dashboard"], timeoutMs: 0 },
    ]);
    if (escalation) {
      logger.info(`Risk escalation triggered: ${escalation.target} (${escalation.reason})`);
      emitter.emit({
        type: "gate",
        timestamp: new Date().toISOString(),
        eventId: `escalation-${generateEventId()}`,
        runId,
        summary: `Escalation: ${escalation.reason} → ${escalation.target}`,
      });
    }
  }

  // Collect IC results from all VP branches (embedded by orchestrator agents)
  const icResults: AgentResult[] = [
    ...(pmResult.icResults ?? []),
    ...(ctoResult.icResults ?? []),
    ...(cisoResult.icResults ?? []),
    ...(cfoResult.icResults ?? []),
    ...(cooResult.icResults ?? []),
  ];

  // Publish all VP + IC results to the registry for direct cross-agent access.
  // SECURITY: wrap each publish in try/catch so a single invalid result doesn't
  // prevent the rest of the results from being published.
  for (const vp of vpResults) {
    try {
      registry.publish(vp);
    } catch (err) {
      logger.info(`Registry publish failed for VP ${vp.role}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const ic of icResults) {
    try {
      registry.publish(ic);
    } catch (err) {
      logger.info(`Registry publish failed for IC ${ic.role}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // NOTE: IC disk verification removed — runICAgent() already publishes to the registry
  // and writes output.md to disk. Re-reading 16 files (~48 syscalls) added no value.

  // ── Phase 6: Cross-functional refinement ──
  let refinementReport: RefinementReport | undefined;
  if (enableRefinement) {
    logger.info("CEO starting cross-functional refinement phase…");
    const config: RefinementConfig = options.refinementConfig ?? {
      enabled: true,
      maxIterations: 1,
      reviewPairs: DEFAULT_REVIEW_PAIRS,
      minSeverity: "high",
    };

    const { critiques, refinements, totalReviews, actionableCritiques, refinedAgents } =
      await runRefinementPhase(idea, ctx, registry, config);

    // Update VP results with refined IC results
    const vpResultsMutable = [pmResult, ctoResult, cisoResult, cfoResult, cooResult];
    for (const [, refinement] of refinements) {
      // Update the IC results within each VP result
      for (const vpResult of vpResultsMutable) {
        if (vpResult.icResults) {
          vpResult.icResults = vpResult.icResults.map((ic) =>
            ic.role === refinement.refinedResult.role ? refinement.refinedResult : ic,
          );
        }
      }
    }

    // Write refinement summary to disk
    await writeRefinementSummary(outputBase, totalReviews, actionableCritiques, refinedAgents, critiques);

    refinementReport = {
      totalReviews,
      actionableCritiques,
      refinedAgents,
      critiques,
      refinements: [...refinements.values()],
    };

    logger.info(`Refinement complete: ${refinedAgents.length} agents refined (${actionableCritiques} actionable critiques)`);
  }

  // ── Collect results for gates ──
  const allVPResults = [pmResult, ctoResult, cisoResult, cfoResult, cooResult];
  const succeededVPs = allVPResults.filter((r) => r.status === "completed" || r.status === "partial");
  const failedVPs = allVPResults.filter((r) => r.status === "failed");

  // ── GATE 1: Review VP outputs BEFORE any external/destructive operations ──
  // SECURITY: This gate runs before Linear sync (external API write) and git
  // commit/push (external repo write). If the user declines here, no external
  // side effects occur. Previously, Linear sync ran BEFORE the gate, meaning an
  // external API had already been written to before the user could approve.
  let userCancelled = false;
  if (enableApproval) {
    emitter.emit({
      type: "gate",
      timestamp: new Date().toISOString(),
      eventId: `gate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      runId,
      summary: `VP outputs ready: ${succeededVPs.length} succeeded, ${failedVPs.length} failed`,
    });
    const approved = await promptApproval(
      `VP outputs ready — ${succeededVPs.length} succeeded, ${failedVPs.length} failed. Proceed with git commit and Linear sync?`,
    );
    if (!approved) {
      logger.info("User skipped external operations. Building plan without git commit or Linear sync.");
      userCancelled = true;
    }
  }

  // ── Phase 7: Linear project sync (after approval gate) ──
  let linearSyncResult: LinearSyncResult | undefined;
  if (!userCancelled && linearApiKey) {
    // GATE 2: Separate approval for external API write (Linear sync).
    // SECURITY: Linear creates/updates entities in an external project management
    // system. A dedicated gate ensures the user can reject this independently.
    let linearApproved = true;
    if (enableApproval) {
      emitter.emit({
        type: "gate",
        timestamp: new Date().toISOString(),
        eventId: `gate-linear-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        runId,
        summary: "Linear sync will write to external Linear API",
      });
      linearApproved = await promptApproval(
        `Linear sync will create/update entities in Linear. Proceed?`,
      );
      if (!linearApproved) {
        logger.info("User skipped Linear sync. Proceeding without it.");
      }
    }

    if (linearApproved) {
      logger.info("CEO starting Linear project sync…");
      try {
        const { runLinearMapper } = await import("../agents/linear-mapper-agent.js");
        const { syncToLinear } = await import("../tools/linear-sync.js");

        // Step 1: Mapper agent reads all outputs -> linear-import.json
        const mapperResult = await runLinearMapper(idea, ctx, registry);

        if (mapperResult.success && mapperResult.import) {
          // Step 2: Sync structured data to Linear
          linearSyncResult = await syncToLinear({
            apiKey: linearApiKey,
            linearImport: mapperResult.import,
            project: {
              idea,
              timestamp: new Date().toISOString(),
              pmResult,
              ctoResult,
              cisoResult,
              cfoResult,
              cooResult,
              icResults,
              status: "complete",
              gaps: [],
            },
            logger,
            maxConcurrent: parseInt(process.env.LINEAR_MAX_CONCURRENT ?? "3", 10),
          });
          logger.info(`Linear sync: ${linearSyncResult.created} created, ${linearSyncResult.skipped} skipped`);
        } else {
          logger.info(`Linear sync skipped: mapper failed — ${mapperResult.error ?? "unknown error"}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.info(`Linear sync failed (non-fatal): ${msg}`);
      }
    }
  }

  // Commit each agent's artifacts on role-specific branches (after all gates).
  // Parallelized: each agent commits to its own branch, so no conflicts.
  if (!userCancelled) {
    const agentsToCommit = [
      ...allVPResults.map((r) => ({ role: r.role, artifacts: r.artifacts, summary: r.summary, result: r })),
      ...icResults.map((r) => ({ role: r.role, artifacts: r.artifacts, summary: r.summary, result: r })),
    ];

    await Promise.all(
      agentsToCommit.map(async ({ role, artifacts, summary, result }) => {
        try {
          const branch = buildBranchName(role, idea);
          commitAgentArtifacts({ projectRoot, branchName: branch, role, artifactPaths: artifacts, summary });
          logger.info(`${role} artifacts committed on branch ${branch}`);
          pushBranchAndCreatePR({ projectRoot, branchName: branch, role, summary });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.info(`${role} git commit failed (non-fatal): ${msg}`);
        }
        try {
          onArtifact(result, projectRoot);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.info(`${role} artifact registration failed (non-fatal): ${msg}`);
        }
      }),
    );
  }

  return await buildPlan(idea, outputBase, vpResults, icResults, logger, projectRoot, onArtifact, refinementReport, linearSyncResult, auditLog, provenance);
}

async function buildPlan(
  idea: string,
  outputBase: string,
  vpResults: AgentResult[],
  icResults: AgentResult[],
  logger: AgentLogger,
  projectRoot: string,
  onArtifact: (result: AgentResult, projectRoot: string) => void,
  refinementReport?: RefinementReport,
  linearSyncResult?: LinearSyncResult,
  auditLog?: AuditLog | null,
  provenance?: ProvenanceTracker | null,
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
    refinementReport,
    linearSync: linearSyncResult,
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

  // ── Phase 12: Run summary metrics ──
  const allResults = [...vpResults, ...icResults];
  const totalInputTokens = allResults.reduce((sum, r) => sum + r.tokenUsage.input, 0);
  const totalOutputTokens = allResults.reduce((sum, r) => sum + r.tokenUsage.output, 0);
  const succeededCount = allResults.filter((r) => r.status === "completed" || r.status === "partial").length;
  const failedCount = allResults.filter((r) => r.status === "failed").length;

  logger.runSummary({
    totalAgents: allResults.length,
    succeeded: succeededCount,
    failed: failedCount,
    retried: logger.getRetryCount(),
    totalTokens: { input: totalInputTokens, output: totalOutputTokens },
    totalDurationMs: logger.getDuration(),
  });

  // ── Phase 10: Audit — record final run completion ──
  if (auditLog) {
    await auditLog.appendEntry({
      agentDid: "did:agent:ceo",
      action: plan.status === "failed" ? "agent_fail" : "agent_complete",
      inputHash: idea.slice(0, 64),
      outputHash: `status:${plan.status}`,
      inputRef: idea,
      outputRef: `${outputBase}/project-plan.json`,
      timestamp: new Date().toISOString(),
      eventId: `audit-${generateEventId()}`,
      signature: "",
    });
  }

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

  const refinementSection = plan.refinementReport
    ? `

## Refinement (Phase 6)

| Metric | Value |
|--------|-------|
| Total Reviews | ${plan.refinementReport.totalReviews} |
| Actionable Critiques | ${plan.refinementReport.actionableCritiques} |
| Agents Refined | ${plan.refinementReport.refinedAgents.join(", ") || "none"} |

### Critiques

${plan.refinementReport.critiques.map((c) => `- **${c.reviewer} → ${c.reviewee}** (${c.severity}): ${c.findings.join("; ")}`).join("\n") || "_No critiques_"}
`
    : "";

  const md = `# Project Plan: ${plan.idea}

**Generated:** ${plan.timestamp}
**Status:** ${plan.status}
**Overall:** ${plan.gaps.length > 0 ? plan.gaps.join("; ") : "All agents completed successfully"}${refinementSection}

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

*Generated by Agent Org v0.5.0*
`;

  await writeOutput(`${outputBase}/project-plan.md`, md);
}
