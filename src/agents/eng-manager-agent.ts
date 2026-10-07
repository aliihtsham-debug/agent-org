import type { AgentResult } from "../types/agent-types.js";
import { runOrchestratorAgent, type AgentContext } from "./base-agent.js";
import { runEngineeringICs } from "./ic-agents.js";
import { createAgentIdentity, registerAgent, generateKeyPair } from "../identity/agent-identity.js";
import { createDelegationCredential, verifyDelegation } from "../identity/delegation.js";
import { AuditLog } from "../audit/audit-log.js";
import { ProvenanceTracker } from "../audit/provenance-tracker.js";
import { PolicyEngine } from "../governance/policy-engine.js";
import { assessRisk } from "../governance/risk-assessment.js";
import { loadMemory } from "../memory/agent-memory.js";
import { recordEvent, calculateScore } from "../memory/reputation-tracker.js";

/**
 * Run the Engineering Manager orchestrator agent.
 *
 * Produces an engineering plan, then spawns Frontend, Backend, AI, and DevOps
 * engineers in parallel. Aggregates all engineering IC results.
 */
export async function runEngManagerAgent(
  idea: string,
  ctx: AgentContext,
  archSummary: string,
  productSummary: string,
): Promise<AgentResult> {
  const enterprise = ctx.enterprise;
  const now = new Date().toISOString();

  // Phase 8: Create Eng Manager identity if enabled
  let engMgrIdentity = null;
  let engMgrKeyPair = null;
  if (enterprise?.enableIdentity && enterprise.agentIdentity && enterprise.agentKeyPair) {
    engMgrKeyPair = await generateKeyPair();
    engMgrIdentity = await createAgentIdentity("engineering-manager", "Engineering Manager Agent");
    const registration = await registerAgent(engMgrIdentity);
    ctx.logger.info(`Engineering Manager identity registered: ${registration.did}`);

    // Create delegation credential: CTO → Eng Manager
    const delegation = await createDelegationCredential(enterprise.agentIdentity, engMgrIdentity.agentId, ["spawn", "delegate", "write_file"], enterprise.agentKeyPair);
    const isValid = await verifyDelegation(delegation);
    ctx.logger.info(`Delegation CTO → Eng Manager: ${isValid ? "verified" : "FAILED"}`);
  }

  // Phase 9: Governance evaluation for Eng Manager actions
  if (enterprise?.enableGovernance && enterprise.policyEngine) {
    const risk = assessRisk("spawn", { riskLevel: "medium", delegationDepth: 2, timestamp: now });
    const govCtx = { riskLevel: risk, delegationDepth: 2, timestamp: now };
    const decision = enterprise.policyEngine.evaluate("engineering-manager", "spawn", govCtx);
    ctx.logger.info(`Eng Manager Governance evaluation: ${decision.effect} (risk: ${risk})`);

    if (decision.effect === "deny") {
      ctx.logger.info("Governance policy denied Eng Manager actions — aborting");
      return {
        role: "engineering-manager",
        status: "failed",
        outputPath: "",
        summary: "Blocked by governance policy",
        artifacts: [],
        tokenUsage: { input: 0, output: 0 },
        durationMs: 0,
        error: "Governance deny",
      };
    }

    if (enterprise.enableAudit && enterprise.auditLog && engMgrIdentity) {
      await enterprise.auditLog.appendEntry({
        agentDid: `did:agent:${engMgrIdentity.agentId}`,
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

  // Phase 12: Load Eng Manager memory if enabled
  if (enterprise?.enableMemory) {
    const engMgrMemory = await loadMemory("engineering-manager");
    if (engMgrMemory.entries.length > 0) {
      ctx.logger.info(`Eng Manager memory loaded: ${engMgrMemory.entries.length} entries`);
    }
  }

  // Run the orchestrator
  const result = await runOrchestratorAgent(idea, ctx, {
    role: "engineering-manager",
    task: "Create an engineering plan for",
    outputPath: "architecture/eng-manager",
    icSpawner: (icCtx, summary) => runEngineeringICs(idea, icCtx, archSummary, productSummary, summary),
    summaryPrefix: "Engineering plan",
    extraContext: `## Architecture Summary\n${archSummary}\n\n## Product Summary\n${productSummary}`,
  });

  // Phase 10: Audit - record Eng Manager completion
  if (enterprise?.enableAudit && enterprise.auditLog && engMgrIdentity) {
    await enterprise.auditLog.appendEntry({
      agentDid: `did:agent:${engMgrIdentity.agentId}`,
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

  // Phase 10: Provenance - track Eng Manager delegation to ICs
  if (enterprise?.enableAudit && enterprise.provenance) {
    if (result.icResults) {
      for (const ic of result.icResults) {
        enterprise.provenance.trackDelegation("engineering-manager", ic.role, "spawn", idea);
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
    await recordEvent("engineering-manager", event);
  }

  // Add reputation score
  if (enterprise?.enableMemory) {
    const rep = await calculateScore("engineering-manager");
    result.reputationScore = rep.overall;
  }

  return result;
}
