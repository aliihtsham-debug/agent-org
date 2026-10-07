import type { AgentResult } from "../types/agent-types.js";
import { runOrchestratorAgent, type AgentContext } from "./base-agent.js";
import { runPMICs } from "./ic-agents.js";
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
 * Run the PM (Product Manager) orchestrator agent.
 *
 * Produces a product strategy overview, then spawns UX Researcher,
 * Roadmap Agent, and Analytics Agent in parallel. Aggregates all IC results.
 */
export async function runPMAgent(
  idea: string,
  ctx: AgentContext,
): Promise<AgentResult> {
  const enterprise = ctx.enterprise;
  const now = new Date().toISOString();

  // Phase 8: Create PM identity if enabled
  let pmIdentity = null;
  let pmKeyPair = null;
  if (enterprise?.enableIdentity && enterprise.agentIdentity && enterprise.agentKeyPair) {
    pmKeyPair = await generateKeyPair();
    pmIdentity = await createAgentIdentity("pm", "PM Agent");
    const registration = await registerAgent(pmIdentity);
    ctx.logger.info(`PM identity registered: ${registration.did}`);

    // Create delegation credential: CEO → PM
    const delegation = await createDelegationCredential(enterprise.agentIdentity, pmIdentity.agentId, ["spawn", "delegate", "write_file"], enterprise.agentKeyPair);
    const isValid = await verifyDelegation(delegation);
    ctx.logger.info(`Delegation CEO → PM: ${isValid ? "verified" : "FAILED"}`);
  }

  // Phase 9: Governance evaluation for PM actions
  if (enterprise?.enableGovernance && enterprise.policyEngine) {
    const risk = assessRisk("spawn", { riskLevel: "medium", delegationDepth: 1, timestamp: now });
    const govCtx = { riskLevel: risk, delegationDepth: 1, timestamp: now };
    const decision = enterprise.policyEngine.evaluate("pm", "spawn", govCtx);
    ctx.logger.info(`PM Governance evaluation: ${decision.effect} (risk: ${risk})`);

    if (decision.effect === "deny") {
      ctx.logger.info("Governance policy denied PM actions — aborting");
      return {
        role: "pm",
        status: "failed",
        outputPath: "",
        summary: "Blocked by governance policy",
        artifacts: [],
        tokenUsage: { input: 0, output: 0 },
        durationMs: 0,
        error: "Governance deny",
      };
    }

    // Record policy evaluation to audit
    if (enterprise.enableAudit && enterprise.auditLog && pmIdentity) {
      await enterprise.auditLog.appendEntry({
        agentDid: `did:agent:${pmIdentity.agentId}`,
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

  // Phase 12: Load PM memory if enabled
  if (enterprise?.enableMemory) {
    const pmMemory = await loadMemory("pm");
    if (pmMemory.entries.length > 0) {
      ctx.logger.info(`PM memory loaded: ${pmMemory.entries.length} entries`);
    }
  }

  // Run the orchestrator
  const result = await runOrchestratorAgent(idea, ctx, {
    role: "pm",
    task: "Create a product strategy summary for",
    outputPath: "specs/pm",
    icSpawner: (icCtx, summary) => runPMICs(idea, icCtx, summary),
    summaryPrefix: "Product strategy",
  });

  // Phase 10: Audit - record PM completion
  if (enterprise?.enableAudit && enterprise.auditLog && pmIdentity) {
    await enterprise.auditLog.appendEntry({
      agentDid: `did:agent:${pmIdentity.agentId}`,
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

  // Phase 10: Provenance - track PM delegation to ICs
  if (enterprise?.enableAudit && enterprise.provenance) {
    if (result.icResults) {
      for (const ic of result.icResults) {
        enterprise.provenance.trackDelegation("pm", ic.role, "spawn", idea);
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
    await recordEvent("pm", event);
    await addEntry("pm", {
      timestamp: now,
      projectId: ctx.runId,
      type: result.status === "completed" ? "outcome" : "lesson",
      content: result.summary,
      importance: result.status === "completed" ? 0.7 : 0.9,
      tags: ["pm", result.status, enterprise.templateName ?? "default"],
    });
  }

  // Add reputation score
  if (enterprise?.enableMemory) {
    const rep = await calculateScore("pm");
    result.reputationScore = rep.overall;
  }

  return result;
}
