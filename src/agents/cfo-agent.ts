import type { AgentResult } from "../types/agent-types.js";
import { runOrchestratorAgent, type AgentContext } from "./base-agent.js";
import { runFinanceICs } from "./ic-agents.js";
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
 * Run the CFO (Chief Financial Officer) orchestrator agent.
 *
 * Produces a financial overview, then spawns Budget Agent and Pricing Agent
 * in parallel. Aggregates both finance IC results.
 */
export async function runCFOAgent(
  idea: string,
  ctx: AgentContext,
): Promise<AgentResult> {
  const enterprise = ctx.enterprise;
  const now = new Date().toISOString();

  // Phase 8: Create CFO identity if enabled
  let cfoIdentity = null;
  let cfoKeyPair = null;
  if (enterprise?.enableIdentity && enterprise.agentIdentity && enterprise.agentKeyPair) {
    cfoKeyPair = await generateKeyPair();
    cfoIdentity = await createAgentIdentity("cfo", "CFO Agent");
    const registration = await registerAgent(cfoIdentity);
    ctx.logger.info(`CFO identity registered: ${registration.did}`);

    // Create delegation credential: CEO → CFO
    const delegation = await createDelegationCredential(enterprise.agentIdentity, cfoIdentity.agentId, ["spawn", "delegate", "write_file"], enterprise.agentKeyPair);
    const isValid = await verifyDelegation(delegation);
    ctx.logger.info(`Delegation CEO → CFO: ${isValid ? "verified" : "FAILED"}`);
  }

  // Phase 9: Governance evaluation for CFO actions
  if (enterprise?.enableGovernance && enterprise.policyEngine) {
    const risk = assessRisk("spawn", { riskLevel: "medium", delegationDepth: 1, timestamp: now });
    const govCtx = { riskLevel: risk, delegationDepth: 1, timestamp: now };
    const decision = enterprise.policyEngine.evaluate("cfo", "spawn", govCtx);
    ctx.logger.info(`CFO Governance evaluation: ${decision.effect} (risk: ${risk})`);

    if (decision.effect === "deny") {
      ctx.logger.info("Governance policy denied CFO actions — aborting");
      return {
        role: "cfo",
        status: "failed",
        outputPath: "",
        summary: "Blocked by governance policy",
        artifacts: [],
        tokenUsage: { input: 0, output: 0 },
        durationMs: 0,
        error: "Governance deny",
      };
    }

    if (enterprise.enableAudit && enterprise.auditLog && cfoIdentity) {
      await enterprise.auditLog.appendEntry({
        agentDid: `did:agent:${cfoIdentity.agentId}`,
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

  // Phase 12: Load CFO memory if enabled
  if (enterprise?.enableMemory) {
    const cfoMemory = await loadMemory("cfo");
    if (cfoMemory.entries.length > 0) {
      ctx.logger.info(`CFO memory loaded: ${cfoMemory.entries.length} entries`);
    }
  }

  // Run the orchestrator
  const result = await runOrchestratorAgent(idea, ctx, {
    role: "cfo",
    task: "Create a financial overview for",
    outputPath: "finance/cfo",
    icSpawner: (icCtx, summary) => runFinanceICs(idea, icCtx, summary),
    summaryPrefix: "Financial overview",
  });

  // Phase 10: Audit - record CFO completion
  if (enterprise?.enableAudit && enterprise.auditLog && cfoIdentity) {
    await enterprise.auditLog.appendEntry({
      agentDid: `did:agent:${cfoIdentity.agentId}`,
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

  // Phase 10: Provenance - track CFO delegation to ICs
  if (enterprise?.enableAudit && enterprise.provenance) {
    if (result.icResults) {
      for (const ic of result.icResults) {
        enterprise.provenance.trackDelegation("cfo", ic.role, "spawn", idea);
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
    await recordEvent("cfo", event);
    await addEntry("cfo", {
      timestamp: now,
      projectId: ctx.runId,
      type: result.status === "completed" ? "outcome" : "lesson",
      content: result.summary,
      importance: result.status === "completed" ? 0.7 : 0.9,
      tags: ["cfo", result.status, enterprise.templateName ?? "default"],
    });
  }

  // Add reputation score
  if (enterprise?.enableMemory) {
    const rep = await calculateScore("cfo");
    result.reputationScore = rep.overall;
  }

  return result;
}
