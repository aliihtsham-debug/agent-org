import type { AgentResult } from "../types/agent-types.js";
import { runOrchestratorAgent, type AgentContext } from "./base-agent.js";
import { runQAICs } from "./ic-agents.js";
import { createAgentIdentity, registerAgent, generateKeyPair } from "../identity/agent-identity.js";
import { createDelegationCredential, verifyDelegation } from "../identity/delegation.js";
import { AuditLog } from "../audit/audit-log.js";
import { ProvenanceTracker } from "../audit/provenance-tracker.js";
import { PolicyEngine } from "../governance/policy-engine.js";
import { assessRisk } from "../governance/risk-assessment.js";
import { loadMemory } from "../memory/agent-memory.js";
import { recordEvent, calculateScore } from "../memory/reputation-tracker.js";

/**
 * Run the QA Manager orchestrator agent.
 *
 * Produces a QA strategy, then spawns Testing Agent and Performance Agent
 * in parallel. Aggregates both QA IC results.
 */
export async function runQAManagerAgent(
  idea: string,
  ctx: AgentContext,
  archSummary: string,
  productSummary: string,
): Promise<AgentResult> {
  const enterprise = ctx.enterprise;
  const now = new Date().toISOString();

  // Phase 8: Create QA Manager identity if enabled
  let qaMgrIdentity = null;
  let qaMgrKeyPair = null;
  if (enterprise?.enableIdentity && enterprise.agentIdentity && enterprise.agentKeyPair) {
    qaMgrKeyPair = await generateKeyPair();
    qaMgrIdentity = await createAgentIdentity("qa-manager", "QA Manager Agent");
    const registration = await registerAgent(qaMgrIdentity);
    ctx.logger.info(`QA Manager identity registered: ${registration.did}`);

    // Create delegation credential: CTO → QA Manager
    const delegation = await createDelegationCredential(enterprise.agentIdentity, qaMgrIdentity.agentId, ["spawn", "delegate", "write_file"], enterprise.agentKeyPair);
    const isValid = await verifyDelegation(delegation);
    ctx.logger.info(`Delegation CTO → QA Manager: ${isValid ? "verified" : "FAILED"}`);
  }

  // Phase 9: Governance evaluation for QA Manager actions
  if (enterprise?.enableGovernance && enterprise.policyEngine) {
    const risk = assessRisk("spawn", { riskLevel: "medium", delegationDepth: 2, timestamp: now });
    const govCtx = { riskLevel: risk, delegationDepth: 2, timestamp: now };
    const decision = enterprise.policyEngine.evaluate("qa-manager", "spawn", govCtx);
    ctx.logger.info(`QA Manager Governance evaluation: ${decision.effect} (risk: ${risk})`);

    if (decision.effect === "deny") {
      ctx.logger.info("Governance policy denied QA Manager actions — aborting");
      return {
        role: "qa-manager",
        status: "failed",
        outputPath: "",
        summary: "Blocked by governance policy",
        artifacts: [],
        tokenUsage: { input: 0, output: 0 },
        durationMs: 0,
        error: "Governance deny",
      };
    }

    if (enterprise.enableAudit && enterprise.auditLog && qaMgrIdentity) {
      await enterprise.auditLog.appendEntry({
        agentDid: `did:agent:${qaMgrIdentity.agentId}`,
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

  // Phase 12: Load QA Manager memory if enabled
  if (enterprise?.enableMemory) {
    const qaMgrMemory = await loadMemory("qa-manager");
    if (qaMgrMemory.entries.length > 0) {
      ctx.logger.info(`QA Manager memory loaded: ${qaMgrMemory.entries.length} entries`);
    }
  }

  // Run the orchestrator
  const result = await runOrchestratorAgent(idea, ctx, {
    role: "qa-manager",
    task: "Create a QA strategy for",
    outputPath: "tests/qa-manager",
    icSpawner: (icCtx, summary) => runQAICs(idea, icCtx, archSummary, productSummary, summary),
    summaryPrefix: "QA strategy",
    extraContext: `## Architecture Summary\n${archSummary}\n\n## Product Summary\n${productSummary}`,
  });

  // Phase 10: Audit - record QA Manager completion
  if (enterprise?.enableAudit && enterprise.auditLog && qaMgrIdentity) {
    await enterprise.auditLog.appendEntry({
      agentDid: `did:agent:${qaMgrIdentity.agentId}`,
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

  // Phase 10: Provenance - track QA Manager delegation to ICs
  if (enterprise?.enableAudit && enterprise.provenance) {
    if (result.icResults) {
      for (const ic of result.icResults) {
        enterprise.provenance.trackDelegation("qa-manager", ic.role, "spawn", idea);
        if (ic.status === "completed" || ic.status === "partial") {
          enterprise.provenance.trackOutput(ic.role, ic.outputPath, [idea]);
        }
      }
    }
  }

  // Phase 12: Record reputation + save memory
  if (enterprise?.enableMemory) {
    const event = result.status === "completed"
      ? { timestamp: now, projectId: ctx.runId, event: "completion" as const, delta: 5, details: `Completed: ${result.summary.slice(0, 80)}` }
      : { timestamp: now, projectId: ctx.runId, event: "failure" as const, delta: -10, details: `Failed: ${result.error ?? "unknown"}` };
    await recordEvent("qa-manager", event);
  }

  // Add reputation score
  if (enterprise?.enableMemory) {
    const rep = await calculateScore("qa-manager");
    result.reputationScore = rep.overall;
  }

  return result;
}
