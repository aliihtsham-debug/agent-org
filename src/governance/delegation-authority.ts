import type { AgentRole } from "../types/agent-types.js";
import type {
  DelegationLog,
  DelegationChain,
  PolicyDecision,
  GovernanceContext,
} from "../types/governance-types.js";
import { PolicyEngine } from "./policy-engine.js";

// -- Role hierarchy for delegation depth --

const VP_ROLES: AgentRole[] = ["cto", "pm", "ciso", "cfo", "coo"];
const MANAGER_ROLES: AgentRole[] = ["engineering-manager", "qa-manager"];

/**
 * Get the maximum delegation depth for a given agent role.
 *
 * - CEO: 3 (CEO -> VP -> Manager -> IC)
 * - VP roles: 2 (VP -> Manager -> IC)
 * - Manager roles: 1 (Manager -> IC)
 * - IC roles: 0 (cannot delegate)
 */
export function getMaxDelegationDepth(role: AgentRole): number {
  if (role === "ceo") {
    return 3;
  }
  if (VP_ROLES.includes(role)) {
    return 2;
  }
  if (MANAGER_ROLES.includes(role)) {
    return 1;
  }
  return 0;
}

/**
 * Validate whether a delegation from one agent to another is permitted
 * by the policy engine.
 *
 * Checks:
 * 1. The delegator has authority to delegate (max delegation depth > 0)
 * 2. The delegation depth in context does not exceed the delegator's max
 * 3. The policy engine permits the delegation action
 */
export function validateDelegation(
  from: AgentRole,
  to: AgentRole,
  policyEngine: PolicyEngine,
  context: GovernanceContext,
): PolicyDecision {
  const maxDepth = getMaxDelegationDepth(from);

  // IC agents cannot delegate
  if (maxDepth === 0) {
    return {
      allowed: false,
      effect: "deny",
      reason: `Agent role "${from}" does not have delegation authority`,
      ruleId: "delegation-depth",
    };
  }

  // Check if current delegation depth exceeds the delegator's max
  if (context.delegationDepth >= maxDepth) {
    return {
      allowed: false,
      effect: "deny",
      reason: `Delegation depth ${context.delegationDepth} exceeds maximum ${maxDepth} for role "${from}"`,
      ruleId: "delegation-depth",
    };
  }

  // Check policy engine for the delegation action
  const decision = policyEngine.evaluate(from, "delegate", context);
  if (!decision.allowed) {
    return {
      allowed: false,
      effect: "deny",
      reason: `Policy engine denied delegation from "${from}" to "${to}": ${decision.reason}`,
      ruleId: decision.ruleId,
    };
  }

  return {
    allowed: true,
    effect: "allow",
    reason: `Delegation from "${from}" to "${to}" permitted at depth ${context.delegationDepth}`,
    ruleId: decision.ruleId,
  };
}

/**
 * Build a delegation chain from a list of delegation logs.
 *
 * The chain represents the full path of delegation from the root delegator
 * (the first "spawn" action) to the leaf agent (the last entry).
 */
export function buildDelegationChain(logs: DelegationLog[]): DelegationChain {
  if (logs.length === 0) {
    return {
      entries: [],
      depth: 0,
      rootDelegator: "" as AgentRole,
      leafAgent: "" as AgentRole,
    };
  }

  // Sort by timestamp to ensure correct ordering
  const sorted = [...logs].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const rootDelegator = sorted[0].from;
  const leafAgent = sorted[sorted.length - 1].to;

  // Count unique delegation levels
  const uniqueAgents = new Set<AgentRole>();
  uniqueAgents.add(sorted[0].from);
  for (const log of sorted) {
    uniqueAgents.add(log.to);
  }

  return {
    entries: sorted,
    depth: uniqueAgents.size - 1,
    rootDelegator,
    leafAgent,
  };
}
