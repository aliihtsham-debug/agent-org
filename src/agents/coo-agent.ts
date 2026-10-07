import type { AgentResult } from "../types/agent-types.js";
import { runOrchestratorAgent, type AgentContext } from "./base-agent.js";
import { runOperationsICs } from "./ic-agents.js";
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
 * Run the COO (Chief Operating Officer) orchestrator agent.
 *
 * Produces an operations plan, then spawns Scheduler, Workflow, and Monitoring
 * agents in parallel. Aggregates all operations IC results.
 */
export async function runCOOAgent(
  idea: string,
  ctx: AgentContext,
): Promise<AgentResult> {
  const enterprise = ctx.enterprise;
  const now = new Date().toISOString();

  // Phase 8: Create COO identity if enabled
  let cooIdentity = null;
  let cooKeyPair = null;
  if (enterprise?.enableIdentity && enterprise.agentIdentity && enterprise.agentKeyPair) {
    cooKeyPair = await generateKeyPair();
    cooIdentity = await createAgentIdentity("coo", "COO Agent");
    const registration = await registerAgent(cooIdentity);
    ctx.logger.info(`COO identity registered: ${registration.did}`);

    // Create delegation credential: CEO → COO
    const delegation = await createDelegationCredential(enterprise.agentIdentity, cooIdentity.agentId, ["spawn", "delegate", "write_file"], enterprise.agentKeyPair);
    const isValid = await verifyDelegation(delegation);
    ctx.logger.info(`Delegation CEO → COO: ${isValid ? "verified" : "FAILED"}`);
  }

  // Phase 9: Governance evaluation for COO actions
  if (enterprise?.enableGovernance && enterprise.policyEngine) {
    const risk = assessRisk("spawn", { riskLevel: "medium", delegationDepth: 1, timestamp: now });
    const govCtx = { riskLevel: risk, delegationDepth: 1, timestamp: now };
    const decision = enterprise.policyEngine.evaluate("coo", "spawn", govCtx);
    ctx.logger.info(`COO Governance evaluation: ${decision.effect} (risk: ${risk})`);

    if (decision.effect === "deny") {
      ctx.logger.info("Governance policy denied COO actions — aborting");
      return {
        role: "coo",
        status: "failed",
        outputPath: "",
        summary: "Blocked by governance policy",
        artifacts: [],
        tokenUsage: { input: 0, output: 0 },
        durationMs: 0,
        error: "Governance deny",
      };
    }

    if (enterprise.enableAudit && enterprise.auditLog && cooIdentity) {
      await enterprise.auditLog.appendEntry({
        agentDid: `did:agent:${cooIdentity.agentId}`,
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

  // Phase 12: Load COO memory if enabled
  if (enterprise?.enableMemory) {
    const cooMemory = await loadMemory("coo");
    if (cooMemory.entries.length > 0) {
      ctx.logger.info(`COO memory loaded: ${cooMemory.entries.length} entries`);
    }
  }

  // Run the orchestrator
  const result = await runOrchestratorAgent(idea, ctx, {
    role: "coo",
    task: "Create an operations plan for",
    outputPath: "operations/coo",
    icSpawner: (icCtx, summary) => runOperationsICs(idea, icCtx, summary),
    summaryPrefix: "Operations plan",
  });

  // Phase 10: Audit - record COO completion
  if (enterprise?.enableAudit && enterprise.auditLog && cooIdentity) {
    await enterprise.auditLog.appendEntry({
      agentDid: `did:agent:${cooIdentity.agentId}`,
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

  // Phase 10: Provenance - track COO delegation to ICs
  if (enterprise?.enableAudit && enterprise.provenance) {
    if (result.icResults) {
      for (const ic of result.icResults) {
        enterprise.provenance.trackDelegation("coo", ic.role, "spawn", idea);
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
    await recordEvent("coo", event);
    await addEntry("coo", {
      timestamp: now,
      projectId: ctx.runId,
      type: result.status === "completed" ? "outcome" : "lesson",
      content: result.summary,
      importance: result.status === "completed" ? 0.7 : 0.9,
      tags: ["coo", result.status, enterprise.templateName ?? "default"],
    });
  }

  // Add reputation score
  if (enterprise?.enableMemory) {
    const rep = await calculateScore("coo");
    result.reputationScore = rep.overall;
  }

  return result;
}
