import type { AgentRole, AgentResult, TaskSpec } from "../types/agent-types.js";
import { ROLE_OUTPUT_DIR } from "../types/agent-types.js";
import { runAgentWithRetry, type AgentContext } from "./base-agent.js";
import { createAgentIdentity, registerAgent, generateKeyPair } from "../identity/agent-identity.js";
import { createDelegationCredential, verifyDelegation } from "../identity/delegation.js";
import { AuditLog } from "../audit/audit-log.js";
import { ProvenanceTracker } from "../audit/provenance-tracker.js";
import { PolicyEngine } from "../governance/policy-engine.js";
import { assessRisk } from "../governance/risk-assessment.js";
import { loadMemory } from "../memory/agent-memory.js";
import { recordEvent, calculateScore } from "../memory/reputation-tracker.js";

/**
 * All IC (Individual Contributor) roles across every branch.
 * These are leaf agents — they produce output but never spawn children.
 */
type ICRole =
  // Engineering
  | "frontend-engineer"
  | "backend-engineer"
  | "ai-engineer"
  | "devops-agent"
  // QA
  | "testing-agent"
  | "performance-agent"
  // Security
  | "security-auditor"
  | "vuln-scanner"
  | "compliance-agent"
  // Finance
  | "budget-agent"
  | "pricing-agent"
  // Operations
  | "scheduler-agent"
  | "workflow-agent"
  | "monitoring-agent"
  // PM sub-agents
  | "ux-researcher"
  | "roadmap-agent"
  | "analytics-agent";

/** Task description templates per IC role. */
const IC_TASK_TEMPLATES: Record<ICRole, string> = {
  "frontend-engineer": "Build the frontend scaffold for",
  "backend-engineer": "Build the backend scaffold for",
  "ai-engineer": "Build the AI/ML integration scaffold for",
  "devops-agent": "Create the DevOps/deployment plan for",
  "testing-agent": "Create a test plan and example tests for",
  "performance-agent": "Create a performance testing and optimization plan for",
  "security-auditor": "Perform a security audit and threat model for",
  "vuln-scanner": "Perform a vulnerability scan and dependency audit for",
  "compliance-agent": "Perform a compliance assessment for",
  "budget-agent": "Create a budget proposal and cost breakdown for",
  "pricing-agent": "Create a pricing strategy and model for",
  "scheduler-agent": "Create a project schedule and sprint plan for",
  "workflow-agent": "Create a workflow specification and development process for",
  "monitoring-agent": "Create a monitoring and alerting plan for",
  "ux-researcher": "Create a UX research plan for",
  "roadmap-agent": "Create a product roadmap for",
  "analytics-agent": "Create an analytics and metrics plan for",
};

function createICTask(
  role: ICRole,
  idea: string,
  architectureSummary: string,
  productSummary: string,
  outputBase: string,
  extraContext = "",
): TaskSpec {
  const id = `${role}-${Date.now()}`;
  const subdir = ROLE_OUTPUT_DIR[role];
  const outputPath = `${outputBase}/${subdir}/${role}`;
  const task = `${IC_TASK_TEMPLATES[role]}: "${idea}"`;

  const contextParts = [
    architectureSummary ? `## Architecture Summary\n${architectureSummary}` : "",
    productSummary ? `## Product Summary\n${productSummary}` : "",
    extraContext ? `## Additional Context\n${extraContext}` : "",
  ].filter(Boolean);

  return {
    id,
    role,
    task,
    context: contextParts.join("\n\n"),
    outputPath,
  };
}

async function runICAgent(
  role: ICRole,
  idea: string,
  ctx: AgentContext,
  architectureSummary = "",
  productSummary = "",
  extraContext = "",
): Promise<AgentResult> {
  const enterprise = ctx.enterprise;
  const now = new Date().toISOString();

  // Phase 8: Create IC identity if enabled
  let icIdentity = null;
  let icKeyPair = null;
  if (enterprise?.enableIdentity && enterprise.agentIdentity && enterprise.agentKeyPair) {
    icKeyPair = await generateKeyPair();
    icIdentity = await createAgentIdentity(role, `${role} Agent`);
    const registration = await registerAgent(icIdentity);
    ctx.logger.info(`${role} identity registered: ${registration.did}`);

    // Create delegation credential: parent → IC
    const delegation = await createDelegationCredential(enterprise.agentIdentity, icIdentity.agentId, ["write_file"], enterprise.agentKeyPair);
    const isValid = await verifyDelegation(delegation);
    ctx.logger.info(`Delegation ${ctx.parentRole} → ${role}: ${isValid ? "verified" : "FAILED"}`);
  }

  // Phase 9: Governance evaluation for IC actions
  if (enterprise?.enableGovernance && enterprise.policyEngine) {
    const risk = assessRisk("spawn", { riskLevel: "low", delegationDepth: 3, timestamp: now });
    const govCtx = { riskLevel: risk, delegationDepth: 3, timestamp: now };
    const decision = enterprise.policyEngine.evaluate(role, "spawn", govCtx);
    ctx.logger.info(`${role} Governance evaluation: ${decision.effect} (risk: ${risk})`);

    if (decision.effect === "deny") {
      ctx.logger.info(`Governance policy denied ${role} actions — aborting`);
      return {
        role,
        status: "failed",
        outputPath: "",
        summary: "Blocked by governance policy",
        artifacts: [],
        tokenUsage: { input: 0, output: 0 },
        durationMs: 0,
        error: "Governance deny",
      };
    }

    if (enterprise.enableAudit && enterprise.auditLog && icIdentity) {
      await enterprise.auditLog.appendEntry({
        agentDid: `did:agent:${icIdentity.agentId}`,
        action: "policy_eval",
        inputHash: `risk:${risk}`,
        outputHash: `decision:${decision.effect}`,
        inputRef: "governance-eval",
        outputRef: "governance-decision",
        timestamp: now,
        eventId: `audit-${Date.now()}`,
        signature: "",
      });
    }
  }

  // Phase 12: Load IC memory if enabled
  if (enterprise?.enableMemory) {
    const icMemory = await loadMemory(role);
    if (icMemory.entries.length > 0) {
      ctx.logger.info(`${role} memory loaded: ${icMemory.entries.length} entries`);
    }
  }

  const task = createICTask(role, idea, architectureSummary, productSummary, ctx.outputBase, extraContext);
  const result = await runAgentWithRetry(task, ctx);

  // Phase 10: Audit - record IC completion
  if (enterprise?.enableAudit && enterprise.auditLog && icIdentity) {
    await enterprise.auditLog.appendEntry({
      agentDid: `did:agent:${icIdentity.agentId}`,
      action: result.status === "failed" ? "agent_fail" : "agent_complete",
      inputHash: idea.slice(0, 64),
      outputHash: result.summary.slice(0, 64),
      inputRef: idea,
      outputRef: result.outputPath,
      timestamp: now,
      eventId: `audit-${Date.now()}`,
      signature: "",
    });
  }

  // Phase 10: Provenance - track IC output
  if (enterprise?.enableAudit && enterprise.provenance) {
    if (result.status === "completed" || result.status === "partial") {
      enterprise.provenance.trackOutput(role, result.outputPath, [idea]);
    }
  }

  // Phase 12: Record reputation + save memory
  if (enterprise?.enableMemory) {
    const event = result.status === "completed"
      ? { timestamp: now, projectId: ctx.runId, event: "completion" as const, delta: 5, details: `Completed: ${result.summary.slice(0, 80)}` }
      : { timestamp: now, projectId: ctx.runId, event: "failure" as const, delta: -10, details: `Failed: ${result.error ?? "unknown"}` };
    await recordEvent(role, event);
  }

  // Add reputation score
  if (enterprise?.enableMemory) {
    const rep = await calculateScore(role);
    result.reputationScore = rep.overall;
  }

  // Publish to registry so sibling and cross-branch agents can access this result.
  // SECURITY: wrap in try/catch so a registry validation failure doesn't crash
  // the entire orchestration. A poisoned/corrupt result is still returned to the
  // caller so the VP can report the failure, but it won't be published.
  try {
    ctx.resultsRegistry.publish(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.logger.info(`${role} registry publish failed: ${msg}`);
  }
  return result;
}

/** Generic branch IC spawner — replaces 6 branch-specific functions. */
async function runBranchICs(
  roles: ICRole[],
  idea: string,
  ctx: AgentContext,
  summaries: { arch?: string; product?: string; extra?: string },
): Promise<AgentResult[]> {
  return Promise.all(
    roles.map((role) =>
      runICAgent(role, idea, ctx, summaries.arch ?? "", summaries.product ?? "", summaries.extra ?? ""),
    ),
  );
}

// ── Branch-specific spawn functions ─────────────────────────────────────

/** Engineering ICs: spawned by Engineering Manager */
export async function runEngineeringICs(
  idea: string,
  ctx: AgentContext,
  archSummary: string,
  productSummary: string,
  engPlanSummary: string,
): Promise<AgentResult[]> {
  return runBranchICs(
    ["frontend-engineer", "backend-engineer", "ai-engineer", "devops-agent"],
    idea, ctx, { arch: archSummary, product: productSummary, extra: engPlanSummary },
  );
}

/** QA ICs: spawned by QA Manager */
export async function runQAICs(
  idea: string,
  ctx: AgentContext,
  archSummary: string,
  productSummary: string,
  qaStrategySummary: string,
): Promise<AgentResult[]> {
  return runBranchICs(
    ["testing-agent", "performance-agent"],
    idea, ctx, { arch: archSummary, product: productSummary, extra: qaStrategySummary },
  );
}

/** Security ICs: spawned by CISO */
export async function runSecurityICs(
  idea: string,
  ctx: AgentContext,
  securityStrategySummary: string,
): Promise<AgentResult[]> {
  return runBranchICs(
    ["security-auditor", "vuln-scanner", "compliance-agent"],
    idea, ctx, { extra: securityStrategySummary },
  );
}

/** Finance ICs: spawned by CFO */
export async function runFinanceICs(
  idea: string,
  ctx: AgentContext,
  financialSummary: string,
): Promise<AgentResult[]> {
  return runBranchICs(
    ["budget-agent", "pricing-agent"],
    idea, ctx, { extra: financialSummary },
  );
}

/** Operations ICs: spawned by COO */
export async function runOperationsICs(
  idea: string,
  ctx: AgentContext,
  opsSummary: string,
): Promise<AgentResult[]> {
  return runBranchICs(
    ["scheduler-agent", "workflow-agent", "monitoring-agent"],
    idea, ctx, { extra: opsSummary },
  );
}

/** PM ICs: spawned by PM Agent */
export async function runPMICs(
  idea: string,
  ctx: AgentContext,
  productStrategySummary: string,
): Promise<AgentResult[]> {
  return runBranchICs(
    ["ux-researcher", "roadmap-agent", "analytics-agent"],
    idea, ctx, { extra: productStrategySummary },
  );
}
