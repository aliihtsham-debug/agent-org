import type { AgentResult } from "../types/agent-types.js";
import { runOrchestratorAgent, type AgentContext } from "./base-agent.js";
import { runSecurityICs } from "./ic-agents.js";
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
 * Run the CISO (Chief Information Security Officer) orchestrator agent.
 *
 * Produces a security strategy, then spawns Security Auditor, Vulnerability Scanner,
 * and Compliance Agent in parallel. Aggregates all security IC results.
 */
export async function runCISOAgent(
  idea: string,
  ctx: AgentContext,
): Promise<AgentResult> {
  const enterprise = ctx.enterprise;
  const now = new Date().toISOString();

  // Phase 8: Create CISO identity if enabled
  let cisoIdentity = null;
  let cisoKeyPair = null;
  if (enterprise?.enableIdentity && enterprise.agentIdentity && enterprise.agentKeyPair) {
    cisoKeyPair = await generateKeyPair();
    cisoIdentity = await createAgentIdentity("ciso", "CISO Agent");
    const registration = await registerAgent(cisoIdentity);
    ctx.logger.info(`CISO identity registered: ${registration.did}`);

    // Create delegation credential: CEO → CISO
    const delegation = await createDelegationCredential(enterprise.agentIdentity, cisoIdentity.agentId, ["spawn", "delegate", "write_file"], enterprise.agentKeyPair);
    const isValid = await verifyDelegation(delegation);
    ctx.logger.info(`Delegation CEO → CISO: ${isValid ? "verified" : "FAILED"}`);
  }

  // Phase 9: Governance evaluation for CISO actions
  if (enterprise?.enableGovernance && enterprise.policyEngine) {
    const risk = assessRisk("spawn", { riskLevel: "high", delegationDepth: 1, timestamp: now });
    const govCtx = { riskLevel: risk, delegationDepth: 1, timestamp: now };
    const decision = enterprise.policyEngine.evaluate("ciso", "spawn", govCtx);
    ctx.logger.info(`CISO Governance evaluation: ${decision.effect} (risk: ${risk})`);

    if (decision.effect === "deny") {
      ctx.logger.info("Governance policy denied CISO actions — aborting");
      return {
        role: "ciso",
        status: "failed",
        outputPath: "",
        summary: "Blocked by governance policy",
        artifacts: [],
        tokenUsage: { input: 0, output: 0 },
        durationMs: 0,
        error: "Governance deny",
      };
    }

    if (enterprise.enableAudit && enterprise.auditLog && cisoIdentity) {
      await enterprise.auditLog.appendEntry({
        agentDid: `did:agent:${cisoIdentity.agentId}`,
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

  // Phase 12: Load CISO memory if enabled
  if (enterprise?.enableMemory) {
    const cisoMemory = await loadMemory("ciso");
    if (cisoMemory.entries.length > 0) {
      ctx.logger.info(`CISO memory loaded: ${cisoMemory.entries.length} entries`);
    }
  }

  // Run the orchestrator
  const result = await runOrchestratorAgent(idea, ctx, {
    role: "ciso",
    task: "Create a security strategy for",
    outputPath: "security/ciso",
    icSpawner: (icCtx, summary) => runSecurityICs(idea, icCtx, summary),
    summaryPrefix: "Security strategy",
  });

  // Phase 10: Audit - record CISO completion
  if (enterprise?.enableAudit && enterprise.auditLog && cisoIdentity) {
    await enterprise.auditLog.appendEntry({
      agentDid: `did:agent:${cisoIdentity.agentId}`,
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

  // Phase 10: Provenance - track CISO delegation to ICs
  if (enterprise?.enableAudit && enterprise.provenance) {
    if (result.icResults) {
      for (const ic of result.icResults) {
        enterprise.provenance.trackDelegation("ciso", ic.role, "spawn", idea);
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
    await recordEvent("ciso", event);
    await addEntry("ciso", {
      timestamp: now,
      projectId: ctx.runId,
      type: result.status === "completed" ? "outcome" : "lesson",
      content: result.summary,
      importance: result.status === "completed" ? 0.7 : 0.9,
      tags: ["ciso", result.status, enterprise.templateName ?? "default"],
    });
  }

  // Add reputation score
  if (enterprise?.enableMemory) {
    const rep = await calculateScore("ciso");
    result.reputationScore = rep.overall;
  }

  return result;
}
