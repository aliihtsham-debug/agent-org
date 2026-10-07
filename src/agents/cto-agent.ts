import type { AgentResult } from "../types/agent-types.js";
import { runManagerOrchestratorAgent, type AgentContext } from "./base-agent.js";
import { runEngManagerAgent } from "./eng-manager-agent.js";
import { runQAManagerAgent } from "./qa-manager-agent.js";
import { createAgentIdentity, registerAgent, generateKeyPair } from "../identity/agent-identity.js";
import { createDelegationCredential, verifyDelegation } from "../identity/delegation.js";
import { AuditLog } from "../audit/audit-log.js";
import { ProvenanceTracker } from "../audit/provenance-tracker.js";
import { PolicyEngine } from "../governance/policy-engine.js";
import { assessRisk } from "../governance/risk-assessment.js";
import { validateDelegation } from "../governance/delegation-authority.js";
import { loadMemory, saveMemory, addEntry } from "../memory/agent-memory.js";
import { recordEvent, calculateScore } from "../memory/reputation-tracker.js";
import { addKnowledge } from "../memory/org-knowledge.js";

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
  const enterprise = ctx.enterprise;
  const now = new Date().toISOString();

  // Phase 8: Create CTO identity if enabled
  let ctoIdentity = null;
  let ctoKeyPair = null;
  if (enterprise?.enableIdentity && enterprise.agentIdentity && enterprise.agentKeyPair) {
    ctoKeyPair = await generateKeyPair();
    ctoIdentity = await createAgentIdentity("cto", "CTO Agent");
    const registration = await registerAgent(ctoIdentity);
    ctx.logger.info(`CTO identity registered: ${registration.did}`);

    // Create delegation credential: CEO → CTO
    const delegation = await createDelegationCredential(enterprise.agentIdentity, ctoIdentity.agentId, ["spawn", "delegate", "write_file"], enterprise.agentKeyPair);
    const isValid = await verifyDelegation(delegation);
    ctx.logger.info(`Delegation CEO → CTO: ${isValid ? "verified" : "FAILED"}`);
  }

  // Phase 9: Governance evaluation for CTO actions
  if (enterprise?.enableGovernance && enterprise.policyEngine) {
    const risk = assessRisk("spawn", { riskLevel: "high", delegationDepth: 1, timestamp: now });
    const govCtx = { riskLevel: risk, delegationDepth: 1, timestamp: now };
    const decision = enterprise.policyEngine.evaluate("cto", "spawn", govCtx);
    ctx.logger.info(`CTO Governance evaluation: ${decision.effect} (risk: ${risk})`);

    if (decision.effect === "deny") {
      ctx.logger.info("Governance policy denied CTO actions — aborting");
      return {
        role: "cto",
        status: "failed",
        outputPath: "",
        summary: "Blocked by governance policy",
        artifacts: [],
        tokenUsage: { input: 0, output: 0 },
        durationMs: 0,
        error: "Governance deny",
      };
    }

    if (enterprise.enableAudit && enterprise.auditLog && ctoIdentity) {
      await enterprise.auditLog.appendEntry({
        agentDid: `did:agent:${ctoIdentity.agentId}`,
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

  // Phase 12: Load CTO memory if enabled
  if (enterprise?.enableMemory) {
    const ctoMemory = await loadMemory("cto");
    if (ctoMemory.entries.length > 0) {
      ctx.logger.info(`CTO memory loaded: ${ctoMemory.entries.length} entries`);
    }
  }

  // Run the manager orchestrator
  const result = await runManagerOrchestratorAgent(idea, ctx, {
    role: "cto",
    task: "Create an Architecture Decision Record (ADR) and system design for",
    outputPath: "architecture/cto",
    managerSpawner: (mgrCtx, archSummary) =>
      Promise.all([
        runEngManagerAgent(idea, mgrCtx, archSummary, ""),
        runQAManagerAgent(idea, mgrCtx, archSummary, ""),
      ]),
    summaryPrefix: "Architecture",
  });

  // Phase 10: Audit - record CTO completion
  if (enterprise?.enableAudit && enterprise.auditLog && ctoIdentity) {
    await enterprise.auditLog.appendEntry({
      agentDid: `did:agent:${ctoIdentity.agentId}`,
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

  // Phase 10: Provenance - track CTO delegation to managers
  if (enterprise?.enableAudit && enterprise.provenance) {
    if (result.icResults) {
      for (const ic of result.icResults) {
        enterprise.provenance.trackDelegation("cto", ic.role, "spawn", idea);
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
    await recordEvent("cto", event);
    await addEntry("cto", {
      timestamp: now,
      projectId: ctx.runId,
      type: result.status === "completed" ? "outcome" : "lesson",
      content: result.summary,
      importance: result.status === "completed" ? 0.7 : 0.9,
      tags: ["cto", result.status, enterprise.templateName ?? "default"],
    });
  }

  // Add reputation score
  if (enterprise?.enableMemory) {
    const rep = await calculateScore("cto");
    result.reputationScore = rep.overall;
  }

  return result;
}
