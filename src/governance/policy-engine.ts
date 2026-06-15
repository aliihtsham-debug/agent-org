import type {
  AgentRole,
} from "../types/agent-types.js";
import type {
  PolicyRule,
  PolicyDecision,
  GovernanceContext,
  PolicyCondition,
  RiskLevel,
} from "../types/governance-types.js";
import { compareRisk } from "../types/governance-types.js";

/**
 * PolicyEngine evaluates policy rules against agent actions.
 *
 * Design principles:
 * - Deny-by-default (fail-closed): if no rule matches, the action is denied.
 * - Highest priority rule wins when multiple rules match.
 * - Conditions are evaluated before a rule is considered matching.
 * - Thread-safe for reads (evaluate) but not for concurrent mutations.
 *
 * Usage:
 *   const engine = new PolicyEngine();
 *   engine.loadPolicies([...]);
 *   const decision = engine.evaluate("backend-engineer", "write_file", context);
 *   if (!decision.allowed) throw new Error(decision.reason);
 */
export class PolicyEngine {
  private policies: PolicyRule[] = [];

  /**
   * Load a set of policies, replacing any existing policies.
   */
  loadPolicies(policies: PolicyRule[]): void {
    this.policies = [...policies];
  }

  /**
   * Add a single policy rule to the engine.
   */
  addPolicy(rule: PolicyRule): void {
    this.policies.push(rule);
  }

  /**
   * Remove a policy rule by ID. Returns true if the rule was found and removed.
   */
  removePolicy(id: string): boolean {
    const index = this.policies.findIndex((p) => p.id === id);
    if (index === -1) {
      return false;
    }
    this.policies.splice(index, 1);
    return true;
  }

  /**
   * Evaluate whether a subject (agent role) can perform an action given the context.
   *
   * Algorithm:
   * 1. Filter policies to those whose subjects include the subject and actions include the action.
   * 2. For each matching policy, evaluate conditions. Skip policies whose conditions are not met.
   * 3. Sort remaining matching policies by priority (highest first).
   * 4. Return the decision from the highest-priority matching policy.
   * 5. If no policy matches, return deny-by-default.
   */
  evaluate(
    subject: AgentRole,
    action: string,
    context: GovernanceContext,
  ): PolicyDecision {
    const matching: PolicyRule[] = [];

    for (const policy of this.policies) {
      // Check if the policy applies to this subject ("*" = wildcard)
      if (!policy.subjects.includes(subject) && !policy.subjects.includes("*")) {
        continue;
      }

      // Check if the policy covers this action
      if (!policy.actions.includes(action) && !policy.actions.includes("*")) {
        continue;
      }

      // Check resource match if policy specifies resources
      if (policy.resources && policy.resources.length > 0) {
        if (!context.resource) {
          continue;
        }
        if (
          !policy.resources.includes(context.resource) &&
          !policy.resources.includes("*")
        ) {
          continue;
        }
      }

      // Evaluate conditions
      if (policy.conditions && policy.conditions.length > 0) {
        const conditionsMet = this.evaluateConditions(policy.conditions, context);
        if (!conditionsMet) {
          continue;
        }
      }

      matching.push(policy);
    }

    if (matching.length === 0) {
      return {
        allowed: false,
        effect: "deny",
        reason: "No matching policy rule",
        ruleId: "default",
      };
    }

    // Sort by priority descending -- highest priority wins
    matching.sort((a, b) => b.priority - a.priority);
    const winner = matching[0];

    const requiresApproval = winner.effect === "require_approval";

    return {
      allowed: winner.effect === "allow" || requiresApproval,
      effect: winner.effect,
      reason: `Matched policy: ${winner.name}`,
      ruleId: winner.id,
      requiresApproval,
    };
  }

  /**
   * Evaluate all conditions for a policy rule.
   * Returns true if ALL conditions are satisfied (AND semantics).
   */
  private evaluateConditions(
    conditions: PolicyCondition[],
    context: GovernanceContext,
  ): boolean {
    for (const condition of conditions) {
      if (!this.evaluateCondition(condition, context)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Evaluate a single condition against the governance context.
   */
  private evaluateCondition(
    condition: PolicyCondition,
    context: GovernanceContext,
  ): boolean {
    switch (condition.type) {
      case "risk_threshold": {
        const threshold = condition.params.level as RiskLevel | undefined;
        if (!threshold) return false;
        // Condition passes if the context risk is at or below the threshold
        return compareRisk(context.riskLevel, threshold) <= 0;
      }

      case "delegation_depth": {
        const maxDepth = condition.params.max as number | undefined;
        if (maxDepth === undefined) return false;
        return context.delegationDepth <= maxDepth;
      }

      case "time_window": {
        const startHour = condition.params.startHour as number | undefined;
        const endHour = condition.params.endHour as number | undefined;
        if (startHour === undefined || endHour === undefined) return false;
        const hour = new Date(context.timestamp).getHours();
        if (startHour <= endHour) {
          return hour >= startHour && hour <= endHour;
        }
        // Wraps midnight
        return hour >= startHour || hour <= endHour;
      }

      case "custom": {
        // Custom conditions require an evaluator function in params
        const evaluator = condition.params.evaluator as
          | ((context: GovernanceContext) => boolean)
          | undefined;
        if (!evaluator) return false;
        return evaluator(context);
      }

      default:
        return false;
    }
  }

  /**
   * Return a copy of all loaded policies.
   */
  getPolicies(): PolicyRule[] {
    return [...this.policies];
  }
}
