import type { AgentRole, AgentResult, ProjectPlan, RefinementConfig, RefinementReport, LinearSyncResult, AgentKeyPair } from "../types/agent-types.js";
import { ROLE_OUTPUT_DIR } from "../types/agent-types.js";
import { writeOutput, readFileIfExists } from "../tools/file-tools.js";
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
import { generateReport, exportReport } from "../audit/compliance-export.js";
// Phase 9 — Governance
import { PolicyEngine } from "../governance/policy-engine.js";
import { DEFAULT_POLICY, STRICT_POLICY, GOVERNMENT_POLICY, BANKING_POLICY } from "../governance/policy-templates.js";
import { assessRisk } from "../governance/risk-assessment.js";
import { validateDelegation } from "../governance/delegation-authority.js";
// Phase 11 — Human-in-the-Loop
import { ApprovalWorkflow } from "../approval/approval-workflow.js";
import { evaluateEscalation } from "../approval/risk-escalation.js";
// Phase 8 — Identity
import { createAgentIdentity, registerAgent, generateKeyPair } from "../identity/agent-identity.js";
import { createDelegationCredential, verifyDelegation } from "../identity/delegation.js";
import { loadKeyPair } from "../identity/identity-store.js";
// Phase 13 — Security
import { createTEEProvider } from "../security/tee-adapter.js";
import { createSecretsProvider } from "../security/secrets-adapter.js";
// Phase 12 — Memory
import { loadMemory, saveMemory, addEntry } from "../memory/agent-memory.js";
import { calculateScore, recordEvent } from "../memory/reputation-tracker.js";
import { addKnowledge } from "../memory/org-knowledge.js";
import { saveCheckpoint } from "../memory/workflow-state.js";
// Phase 15 — Templates
import { runEnterpriseOnboarding } from "../templates/enterprise-onboarding.js";
import { createWhiteLabelConfig } from "../templates/white-label.js";
// Phase 16 — Marketplace
import { createBlueprintRegistry } from "../marketplace/blueprint-registry.js";
// Phase 10 — Compliance
import type { AuditEntry, ComplianceReport } from "../types/audit-types.js";

// ── Meta-Loop — helper for file hashing ──
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/**
 * Compute SHA-256 hash of a file. Returns "unknown" on read failure.
 */
async function hashFile(filePath: string): Promise<string> {
  try {
    const content = await readFile(filePath, "utf-8");
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return "unknown";
  }
}

export interface CEOOptions {
  idea: string;
  apiKey: string;
  baseURL: string;
  outputBase: string;
  logger: AgentLogger;
  projectRoot: string;
  /** Phase 11 — Whether to pause at milestone gates for human approval */
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
  /** Phase 12 — Enable persistent agent memory + reputation scoring */
  enableMemory?: boolean;
  /** Phase 16 — Enable AI Organization Marketplace */
  enableMarketplace?: boolean;
  /** Phase 15 — Governance template name: default | strict | government | banking */
  templateName?: string;
  /** Phase 16 — Blueprint ID to load from marketplace */
  blueprintId?: string;
  /** Phase 15 — Run enterprise onboarding flow */
  runOnboard?: boolean;
  /** Phase 15 — White-label organization name */
  whiteLabelName?: string;
  /** Meta-loop: enable self-evolution (capture / propose / apply / auto) */
  metaLoopMode?: "capture" | "propose" | "apply" | "auto" | "advisory";
}

// ── Enterprise Options (grouped for buildPlan) ──────────────────────────

interface EnterpriseOptions {
  enableIdentity: boolean;
  enableGovernance: boolean;
  enableAudit: boolean;
  enableSecurity: boolean;
  enableMemory: boolean;
  templateName: string;
}

export async function runCEOAgent(options: CEOOptions): Promise<ProjectPlan> {
  const { idea, apiKey, baseURL, outputBase, logger, projectRoot, enableApproval = false, enableRefinement = false, linearApiKey, enableIdentity = false, enableGovernance = false, enableAudit = false, enableSecurity = false, enableMemory = false, enableMarketplace = false, templateName = "default", blueprintId = "", runOnboard = false, whiteLabelName = "" } = options;

  // Capture a single timestamp for consistency across the run
  const now = new Date().toISOString();

  logger.banner(`Agent Org — Product Idea: "${idea}"`);

  // ── Generate run ID for correlation (Phase 12) ──
  const runId = generateRunId();
  logger.setRunId(runId);

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 15 — Enterprise Onboarding, Templates & White-Label
  // ══════════════════════════════════════════════════════════════════════

  if (runOnboard) {
    logger.info("Starting enterprise onboarding…");
    const existingMemory = enableMemory ? await loadMemory("ceo") : null;
    const complianceReqs = templateName === "banking" ? ["PCI-DSS", "SOX"]
      : templateName === "government" ? ["FedRAMP", "NIST-800-53"]
      : ["SOC2"];
    const onboardResult = await runEnterpriseOnboarding({
      orgName: whiteLabelName || "Enterprise",
      industry: "technology",
      teamSize: "enterprise",
      complianceRequirements: complianceReqs,
      governanceTemplate: templateName as "default" | "strict" | "government" | "banking",
      dashboardPort: 3010,
      branding: whiteLabelName && createWhiteLabelConfig(whiteLabelName).enabledFeatures ? { primaryColor: "#3b82f6" } : undefined,
    }, existingMemory);
    logger.info(`Onboarding complete: ${onboardResult.success ? "success" : "failed"} (template: ${onboardResult.templateName})`);
  }

  // ── Phase 15: White-Label Configuration ──
  let whiteLabelConfig: ReturnType<typeof createWhiteLabelConfig> | null = null;
  if (whiteLabelName) {
    whiteLabelConfig = createWhiteLabelConfig(whiteLabelName, templateName as "default" | "strict" | "government" | "banking" | "startup");
    logger.info(`White-label configured: ${whiteLabelConfig.orgName} (${whiteLabelConfig.template} template)`);
    logger.info(`Enabled features: ${Object.entries(whiteLabelConfig.enabledFeatures).filter(([, v]) => v).map(([k]) => k).join(", ")}`);
  }

  // ── Phase 16: Load Organizational Blueprint ──
  let selectedBlueprint: Awaited<ReturnType<ReturnType<typeof createBlueprintRegistry>["getBlueprint"]>> = null;
  if (enableMarketplace && blueprintId) {
    logger.info(`Loading blueprint: ${blueprintId}…`);
    const registry = createBlueprintRegistry();
    selectedBlueprint = await registry.getBlueprint(blueprintId);
    if (selectedBlueprint) {
      logger.info(`Blueprint loaded: "${selectedBlueprint.name}" v${selectedBlueprint.version} — ${selectedBlueprint.agentRoles.length} roles`);
      logger.info(`Governance template from blueprint: ${selectedBlueprint.governanceTemplate}`);
    } else {
      logger.info(`Blueprint "${blueprintId}" not found — using default org structure`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 8 — Agent Identity Layer
  // ══════════════════════════════════════════════════════════════════════

  // CEO identity — create if enabled
  let ceoIdentity: Awaited<ReturnType<typeof createAgentIdentity>> | null = null;
  let ceoKeyPair: AgentKeyPair | null = null;
  if (enableIdentity) {
    ceoKeyPair = await generateKeyPair();
    ceoIdentity = await createAgentIdentity("ceo", "CEO Agent");
    const registration = await registerAgent(ceoIdentity);
    logger.info(`CEO identity registered: ${registration.did} (status: ${registration.status})`);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PHASE 13 — Enterprise Security Platform
  // ══════════════════════════════════════════════════════════════════════

  let teeProvider: ReturnType<typeof createTEEProvider> | null = null;
  let secretsProvider: ReturnType<typeof createSecretsProvider> | null = null;
  if (enableSecurity) {
    teeProvider = createTEEProvider("local");
    const attestation = await teeProvider.attest();
    logger.info(`TEE attestation: ${attestation.valid ? "valid" : "invalid"} (${attestation.environment})`);
    if (!attestation.valid) {
      logger.info("WARNING: TEE attestation invalid — running in degraded security mode");
    }
    secretsProvider = createSecretsProvider("local");
    logger.info("Secrets vault initialized (local provider)");
  }

  // ── Phase 10: Initialize audit log + provenance tracker ──
  const auditLog = enableAudit ? new AuditLog() : null;
  const provenance = enableAudit ? new ProvenanceTracker() : null;
  if (enableAudit && provenance) {
    provenance.trackDecision(runId, idea);
  }

  // ── Phase 9: Initialize governance policy engine ──
  const policyEngine = enableGovernance ? new PolicyEngine() : null;
  if (policyEngine) {
    const templateMap: Record<string, typeof DEFAULT_POLICY> = {
      default: DEFAULT_POLICY,
      strict: STRICT_POLICY,
      government: GOVERNMENT_POLICY,
      banking: BANKING_POLICY,
    };
    const selectedTemplate = templateMap[templateName] ?? DEFAULT_POLICY;
    selectedTemplate.rules.forEach((rule) => policyEngine.addPolicy(rule));
    logger.info(`Governance policy loaded: "${selectedTemplate.name}" (${selectedTemplate.rules.length} rules)`);
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

  // ── Phase 9: Governance — evaluate risk + delegation authority before spawning VPs ──
  if (policyEngine) {
    const risk = assessRisk("spawn", { riskLevel: "medium", delegationDepth: 0, timestamp: now });
    const govCtx = {
      riskLevel: risk,
      delegationDepth: 0,
      timestamp: now,
    };
    const decision = policyEngine.evaluate("ceo", "spawn", govCtx);
    logger.info(`Governance evaluation: ${decision.effect} (risk: ${risk}, policy: ${decision.ruleId ?? "none"})`);

    // Phase 9: Validate delegation authority
    const delegationDecision = validateDelegation("ceo", "pm", policyEngine, govCtx);
    if (!delegationDecision.allowed) {
      logger.info(`Delegation authority check failed: ${delegationDecision.reason}`);
    }

    if (decision.effect === "deny") {
      logger.info("Governance policy denied VP spawning — aborting");
      updateStatus("failed");
      return {
        idea,
        timestamp: now,
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
    if (auditLog && ceoIdentity) {
      await auditLog.appendEntry({
        agentDid: `did:agent:${ceoIdentity.agentId}`,
        action: "policy_eval",
        inputHash: `risk:${risk}`,
        outputHash: `decision:${decision.effect}`,
        inputRef: "governance-eval",
        outputRef: "governance-decision",
        timestamp: now,
        eventId: `audit-${generateEventId()}`,
        signature: "",
      });
    }
  }

  // ── Phase 10: Audit — record CEO decision delegation ──
  if (auditLog) {
    await auditLog.appendEntry({
      agentDid: ceoIdentity ? `did:agent:${ceoIdentity.agentId}` : "did:agent:ceo",
      action: "agent_spawn",
      inputHash: idea.slice(0, 64),
      outputHash: "vps-spawned",
      inputRef: idea,
      outputRef: "outputs/ceo",
      timestamp: now,
      eventId: `audit-${generateEventId()}`,
      signature: ceoIdentity && ceoKeyPair
        ? await (await import("../identity/agent-identity.js")).signData(ceoIdentity, idea.slice(0, 64), ceoKeyPair)
        : "",
    });
  }

  // ── Phase 8: Create VP Identities + Delegation Credentials ──
  const vpRoles: AgentRole[] = ["pm", "cto", "ciso", "cfo", "coo"];
  const vpIdentities = await spawnVPIdentities(enableIdentity, ceoIdentity, ceoKeyPair, vpRoles, logger);

  // ── Phase 12: Load Persistent Memory for agents ──
  if (enableMemory) {
    const ceoMemory = await loadMemory("ceo");
    if (ceoMemory.entries.length > 0) {
      logger.info(`CEO memory loaded: ${ceoMemory.entries.length} entries (last: ${ceoMemory.lastUpdated})`);
    }
    // Save a checkpoint before VP spawning
    await saveCheckpoint(runId, {
      workflowId: runId,
      timestamp: now,
      state: { phase: "pre-vp-spawn", idea, templateName },
      completedSteps: ["identity", "governance-init", "audit-init"],
      pendingSteps: ["vp-spawning", "ic-spawning", "refinement", "compliance"],
    });
  }

  logger.info("CEO spawning 5 VPs in parallel: PM, CTO, CISO, CFO, COO…");

  // Use Promise.allSettled so one VP throwing doesn't kill the whole orchestration.
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
      status: "failed",
      outputPath: `${outputBase}/error`,
      summary: `VP ${label} failed: ${error}`,
      artifacts: [],
      tokenUsage: { input: 0, output: 0 },
      durationMs: 0,
      error,
    } satisfies AgentResult;
  });

  const [pmResult, ctoResult, cisoResult, cfoResult, cooResult] = vpResults;

  // ── Phase 10: Audit — record VP completions/failures (parallelized) ──
  if (auditLog) {
    await Promise.all(vpResults.map((vp) =>
      auditLog.appendEntry({
        agentDid: `did:agent:${vp.role}`,
        action: vp.status === "failed" ? "agent_fail" : "agent_complete",
        inputHash: idea.slice(0, 64),
        outputHash: vp.summary.slice(0, 64),
        inputRef: idea,
        outputRef: vp.outputPath,
        timestamp: now,
        eventId: `audit-${generateEventId()}`,
        signature: "",
      })
    ));
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
        timestamp: now,
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
  let userCancelled = false;
  if (enableApproval) {
    emitter.emit({
      type: "gate",
      timestamp: now,
      eventId: `gate-${generateEventId()}`,
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
    let linearApproved = true;
    if (enableApproval) {
      emitter.emit({
        type: "gate",
        timestamp: now,
        eventId: `gate-linear-${generateEventId()}`,
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

        const mapperResult = await runLinearMapper(idea, ctx, registry);

        if (mapperResult.success && mapperResult.import) {
          linearSyncResult = await syncToLinear({
            apiKey: linearApiKey,
            linearImport: mapperResult.import,
            project: {
              idea,
              timestamp: now,
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
          logger.info(`${role} git commit failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
        }
        try {
          onArtifact(result, projectRoot);
        } catch (err) {
          logger.info(`${role} artifact registration failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    );
  }

  // ── Phase 12: Record reputation + save memory (parallelized) ──
  if (enableMemory) {
    const allResults = [...vpResults, ...icResults];
    const allFailed = vpResults.every((r) => r.status === "failed");
    await Promise.all(allResults.map(async (result) => {
      const event = result.status === "completed"
        ? { timestamp: now, projectId: runId, event: "completion" as const, delta: 5, details: `Completed: ${result.summary.slice(0, 80)}` }
        : { timestamp: now, projectId: runId, event: "failure" as const, delta: -10, details: `Failed: ${result.error ?? "unknown"}` };
      await recordEvent(result.role, event);
      await addEntry(result.role, {
        timestamp: now,
        projectId: runId,
        type: result.status === "completed" ? "outcome" : "lesson",
        content: result.summary,
        importance: result.status === "completed" ? 0.7 : 0.9,
        tags: [result.role, result.status, templateName],
      });
    }));

    // Add organizational knowledge
    await addKnowledge({
      projectId: runId,
      type: "decision",
      content: `Run completed with status: ${allFailed ? "failed" : "partial/complete"}`,
      relevance: [templateName, "enterprise", "orchestration"],
      sourceAgents: vpResults.map((r) => r.role),
    });

    // Save final checkpoint
    await saveCheckpoint(runId, {
      workflowId: runId,
      timestamp: now,
      state: { phase: "complete", idea, templateName, totalAgents: allResults.length },
      completedSteps: ["identity", "governance-init", "audit-init", "vp-spawning", "ic-spawning", "compliance"],
      pendingSteps: [],
    });
    logger.info("Memory saved, reputation updated, knowledge recorded");
  }

  // ── Phase 10: Generate Compliance Report ──
  let complianceReport: ComplianceReport | undefined;
  if (enableAudit && auditLog && provenance) {
    const auditEntries = await auditLog.getEntries();
    const allProvenance = provenance.getAllProvenance();
    const standard = templateName === "banking" ? "SOC2" as const
      : templateName === "government" ? "ISO27001" as const
      : "SOC2" as const;
    complianceReport = generateReport(standard, auditEntries, allProvenance);
    const reportPath = `${outputBase}/compliance-report.json`;
    await exportReport(complianceReport, reportPath);
    logger.info(`Compliance report generated: ${complianceReport.findings.length} findings (${standard}) → ${reportPath}`);
  }

  const enterprise: EnterpriseOptions = { enableIdentity, enableGovernance, enableAudit, enableSecurity, enableMemory, templateName };

  // ── Meta-Loop: collect signals and propose improvements ──
  if (options.metaLoopMode) {
    try {
      const { evaluateAndApply } = await import("../meta-loop/meta-orchestrator.js");
      const promptVersion = await hashFile(`${projectRoot}/src/prompts/agent-prompts.ts`);
      const governanceVersion = await hashFile(`${projectRoot}/src/governance/policy-templates.ts`);
      const metaProposals = await evaluateAndApply(
        {
          outputBase,
          projectRoot,
          runId,
          idea,
          status: "complete", // Will be refined below if failures exist
          vpResults,
          icResults,
          governanceDenials: 0, // TODO: wire from policy engine when available
          appliedProposalIds: [],
          promptVersion,
          governanceVersion,
        },
        options.metaLoopMode,
      );
      if (metaProposals.length > 0) {
        logger.info(`Meta-loop: ${metaProposals.length} proposal(s) generated (${options.metaLoopMode} mode)`);
      }
    } catch (err) {
      // Meta-loop is non-fatal — never let it break the main orchestration.
      const msg = err instanceof Error ? err.message : String(err);
      logger.info(`Meta-loop: skipped due to error: ${msg}`);
    }
  }

  return await buildPlan(idea, outputBase, vpResults, icResults, logger, projectRoot, onArtifact, refinementReport, linearSyncResult, auditLog, provenance, complianceReport, enterprise);
}

// ── Helper: Spawn VP identities + delegation credentials ─────────────────

async function spawnVPIdentities(
  enableIdentity: boolean,
  ceoIdentity: Awaited<ReturnType<typeof createAgentIdentity>> | null,
  ceoKeyPair: AgentKeyPair | null,
  vpRoles: AgentRole[],
  logger: AgentLogger,
): Promise<Record<string, { identity: Awaited<ReturnType<typeof createAgentIdentity>>; keyPair: AgentKeyPair }>> {
  if (!enableIdentity || !ceoIdentity || !ceoKeyPair) return {};
  const vpIdentities: Record<string, { identity: Awaited<ReturnType<typeof createAgentIdentity>>; keyPair: AgentKeyPair }> = {};
  // Generate all VP key pairs and identities in parallel
  const vpEntries = await Promise.all(vpRoles.map(async (vpRole) => {
    const vpKeyPair = await generateKeyPair();
    const vpIdentity = await createAgentIdentity(vpRole, `${vpRole.toUpperCase()} Agent`);
    const vpRegistration = await registerAgent(vpIdentity);
    logger.info(`${vpRole.toUpperCase()} identity: ${vpRegistration.did}`);

    // Create delegation credential: CEO → VP
    const delegation = await createDelegationCredential(ceoIdentity, vpIdentity.agentId, ["spawn", "delegate", "write_file"], ceoKeyPair);
    const isValid = await verifyDelegation(delegation);
    logger.info(`Delegation CEO → ${vpRole}: ${isValid ? "verified" : "FAILED"}`);

    return [vpRole, { identity: vpIdentity, keyPair: vpKeyPair }] as const;
  }));
  for (const [role, entry] of vpEntries) {
    vpIdentities[role] = entry;
  }
  return vpIdentities;
}

// ── Build Plan ───────────────────────────────────────────────────────────

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
  complianceReport?: ComplianceReport,
  enterprise?: EnterpriseOptions,
): Promise<ProjectPlan> {
  const now = new Date().toISOString();
  const { enableIdentity = false, enableGovernance = false, enableAudit = false, enableSecurity = false, enableMemory = false, templateName = "default" } = enterprise ?? {};

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

  // ── Phase 12: Attach reputation scores to results ──
  if (enableMemory) {
    for (const result of [...vpResults, ...icResults]) {
      const rep = await calculateScore(result.role);
      result.reputationScore = rep.overall;
    }
  }

  const plan: ProjectPlan = {
    idea,
    timestamp: now,
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
    complianceReport,
    enterpriseMeta: {
      identityEnabled: enableIdentity,
      governanceEnabled: enableGovernance,
      auditEnabled: enableAudit,
      securityEnabled: enableSecurity,
      memoryEnabled: enableMemory,
      templateName,
      totalAgents: vpResults.length + icResults.length,
      signedActions: enableAudit && auditLog ? (await auditLog.getEntries()).length : 0,
    },
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
      timestamp: now,
      eventId: `audit-${generateEventId()}`,
      signature: "",
    });
  }

  updateStatus(plan.status === "failed" ? "failed" : "complete");

  return plan;
}

// ── Write Plan (Markdown) ────────────────────────────────────────────────

async function writePlan(plan: ProjectPlan, outputBase: string): Promise<void> {
  // JSON plan for programmatic consumption
  await writeOutput(
    `${outputBase}/project-plan.json`,
    JSON.stringify(plan, null, 2),
  );

  const vpRows = (label: string, result: AgentResult) =>
    `| ${label} | ${result.status} | ${result.summary} | ${result.artifacts.join(", ") || "none"} |`;

  const md = `# Project Plan: ${plan.idea}

**Generated:** ${plan.timestamp}
**Status:** ${plan.status}
**Overall:** ${plan.gaps.length > 0 ? plan.gaps.join("; ") : "All agents completed successfully"}${buildRefinementSection(plan.refinementReport)}

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
${buildEnterpriseSection(plan.enterpriseMeta)}${buildComplianceSection(plan.complianceReport)}
---

*Generated by Agent Org v0.5.0 — Enterprise Edition*
`;

  await writeOutput(`${outputBase}/project-plan.md`, md);
}

// ── Plan section builders ─────────────────────────────────────────────────

function buildRefinementSection(refinementReport?: RefinementReport): string {
  if (!refinementReport) return "";
  return `

## Refinement (Phase 6)

| Metric | Value |
|--------|-------|
| Total Reviews | ${refinementReport.totalReviews} |
| Actionable Critiques | ${refinementReport.actionableCritiques} |
| Agents Refined | ${refinementReport.refinedAgents.join(", ") || "none"} |

### Critiques

${refinementReport.critiques.map((c) => `- **${c.reviewer} → ${c.reviewee}** (${c.severity}): ${c.findings.join("; ")}`).join("\n") || "_No critiques_"}
`;
}

function buildEnterpriseSection(enterpriseMeta?: ProjectPlan["enterpriseMeta"]): string {
  if (!enterpriseMeta) return "";
  return `

## Enterprise Features (Phases 8-16)

| Feature | Status |
|---------|--------|
| Agent Identity (Phase 8) | ${enterpriseMeta.identityEnabled ? "✅ Enabled" : "❌ Disabled"} |
| Governance Policy (Phase 9) | ${enterpriseMeta.governanceEnabled ? "✅ Enabled" : "❌ Disabled"} |
| Audit System (Phase 10) | ${enterpriseMeta.auditEnabled ? "✅ Enabled" : "❌ Disabled"} |
| Security Platform (Phase 13) | ${enterpriseMeta.securityEnabled ? "✅ Enabled" : "❌ Disabled"} |
| Agent Memory (Phase 12) | ${enterpriseMeta.memoryEnabled ? "✅ Enabled" : "❌ Disabled"} |
| Template | ${enterpriseMeta.templateName} |
| Total Agents | ${enterpriseMeta.totalAgents} |
| Signed Actions | ${enterpriseMeta.signedActions} |
`;
}

function buildComplianceSection(complianceReport?: ComplianceReport): string {
  if (!complianceReport) return "";
  return `

## Compliance Report (Phase 10)

**Standard:** ${complianceReport.standard}
**Generated:** ${complianceReport.generatedAt}
**Scope:** ${complianceReport.scope}

### Findings

| Severity | Description | Remediation |
|----------|-------------|-------------|
${complianceReport.findings.map((f) => `| ${f.severity} | ${f.description} | ${f.remediation ?? "N/A"} |`).join("\n") || "| — | No findings | — |"}
`;
}
