import { describe, it, expect, beforeEach } from "vitest";
import { PolicyEngine } from "../src/governance/policy-engine.js";
import {
  DEFAULT_POLICY,
  STRICT_POLICY,
  GOVERNMENT_POLICY,
  BANKING_POLICY,
} from "../src/governance/policy-templates.js";
import { assessRisk, assessAgentActionPlan } from "../src/governance/risk-assessment.js";
import {
  validateDelegation,
  getMaxDelegationDepth,
  buildDelegationChain,
} from "../src/governance/delegation-authority.js";
import type { AgentRole, AgentResult } from "../src/types/agent-types.js";
import type { GovernanceContext, PolicyRule } from "../src/types/governance-types.js";

// -- Test helpers --

function makeContext(overrides: Partial<GovernanceContext> = {}): GovernanceContext {
  return {
    riskLevel: "medium",
    delegationDepth: 0,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    role: "cto",
    status: "completed",
    outputPath: "outputs/cto",
    summary: "Test result",
    artifacts: ["outputs/cto/output.md"],
    tokenUsage: { input: 100, output: 200 },
    durationMs: 500,
    ...overrides,
  };
}

function makeRule(partial: Partial<PolicyRule> & { id: string; name: string }): PolicyRule {
  return {
    description: "",
    effect: "allow",
    subjects: [],
    actions: [],
    priority: 100,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

// -- Tests --

describe("PolicyEngine", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
  });

  // Test 1: Policy engine allows permitted actions
  it("should allow permitted actions", () => {
    engine.addPolicy(
      makeRule({
        id: "allow-read",
        name: "Allow read",
        subjects: ["backend-engineer"],
        actions: ["read_file"],
        effect: "allow",
        priority: 10,
      }),
    );

    const decision = engine.evaluate("backend-engineer", "read_file", makeContext());
    expect(decision.allowed).toBe(true);
    expect(decision.effect).toBe("allow");
    expect(decision.ruleId).toBe("allow-read");
  });

  // Test 2: Policy engine denies non-permitted actions (deny-by-default)
  it("should deny non-permitted actions (deny-by-default)", () => {
    engine.addPolicy(
      makeRule({
        id: "allow-read",
        name: "Allow read",
        subjects: ["backend-engineer"],
        actions: ["read_file"],
        effect: "allow",
        priority: 10,
      }),
    );

    const decision = engine.evaluate("backend-engineer", "delete_database", makeContext());
    expect(decision.allowed).toBe(false);
    expect(decision.effect).toBe("deny");
    expect(decision.ruleId).toBe("default");
    expect(decision.reason).toBe("No matching policy rule");
  });

  // Test 3: Higher priority rules override lower priority
  it("should let higher priority rules override lower priority", () => {
    engine.addPolicy(
      makeRule({
        id: "allow-deploy",
        name: "Allow deploy",
        subjects: ["devops-agent"],
        actions: ["deploy"],
        effect: "allow",
        priority: 10,
      }),
    );
    engine.addPolicy(
      makeRule({
        id: "deny-deploy",
        name: "Deny deploy",
        subjects: ["devops-agent"],
        actions: ["deploy"],
        effect: "deny",
        priority: 100,
      }),
    );

    const decision = engine.evaluate("devops-agent", "deploy", makeContext());
    expect(decision.allowed).toBe(false);
    expect(decision.effect).toBe("deny");
    expect(decision.ruleId).toBe("deny-deploy");
  });

  // Test 4: Condition evaluation (risk threshold)
  it("should evaluate risk threshold conditions", () => {
    engine.addPolicy(
      makeRule({
        id: "risk-gated",
        name: "Risk gated action",
        subjects: ["backend-engineer"],
        actions: ["write_file"],
        effect: "allow",
        conditions: [
          { type: "risk_threshold", params: { level: "medium" } },
        ],
        priority: 10,
      }),
    );

    // Low risk should pass (at or below threshold)
    const lowRiskDecision = engine.evaluate(
      "backend-engineer",
      "write_file",
      makeContext({ riskLevel: "low" }),
    );
    expect(lowRiskDecision.allowed).toBe(true);

    // Critical risk should fail (exceeds threshold)
    const criticalRiskDecision = engine.evaluate(
      "backend-engineer",
      "write_file",
      makeContext({ riskLevel: "critical" }),
    );
    expect(criticalRiskDecision.allowed).toBe(false);
    expect(criticalRiskDecision.ruleId).toBe("default");
  });

  // Test 5: Approval requirements for critical-risk actions
  it("should require approval for critical-risk actions", () => {
    engine.addPolicy(
      makeRule({
        id: "require-approval-external",
        name: "Require approval for external",
        subjects: ["backend-engineer"],
        actions: ["external_api_call"],
        effect: "require_approval",
        priority: 50,
      }),
    );

    const decision = engine.evaluate("backend-engineer", "external_api_call", makeContext());
    expect(decision.allowed).toBe(true);   // Allowed but requires approval
    expect(decision.effect).toBe("require_approval");
    expect(decision.requiresApproval).toBe(true);
  });
});

describe("Delegation Authority", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
    engine.addPolicy(
      makeRule({
        id: "allow-delegate",
        name: "Allow delegation",
        subjects: ["ceo", "cto", "pm", "ciso", "cfo", "coo"],
        actions: ["delegate"],
        effect: "allow",
        priority: 10,
      }),
    );
    engine.addPolicy(
      makeRule({
        id: "allow-spawn",
        name: "Allow spawn",
        subjects: ["engineering-manager", "qa-manager"],
        actions: ["delegate"],
        effect: "allow",
        priority: 10,
      }),
    );
  });

  // Test 6: Delegation depth enforcement
  it("should enforce delegation depth limits", () => {
    // CEO can delegate up to depth 3
    expect(getMaxDelegationDepth("ceo")).toBe(3);
    // VP roles can delegate up to depth 2
    expect(getMaxDelegationDepth("cto")).toBe(2);
    // Manager roles can delegate up to depth 1
    expect(getMaxDelegationDepth("engineering-manager")).toBe(1);
    // IC roles cannot delegate
    expect(getMaxDelegationDepth("backend-engineer")).toBe(0);

    // CEO at depth 2 should be allowed
    const decision = validateDelegation(
      "ceo",
      "cto",
      engine,
      makeContext({ delegationDepth: 2 }),
    );
    expect(decision.allowed).toBe(true);

    // CEO at depth 3 (max) should be denied (depth >= max)
    const deniedDecision = validateDelegation(
      "ceo",
      "cto",
      engine,
      makeContext({ delegationDepth: 3 }),
    );
    expect(deniedDecision.allowed).toBe(false);

    // IC cannot delegate at all
    const icDecision = validateDelegation(
      "frontend-engineer",
      "testing-agent",
      engine,
      makeContext({ delegationDepth: 0 }),
    );
    expect(icDecision.allowed).toBe(false);
  });
});

describe("Policy Templates", () => {
  // Test 7: Template loading (DEFAULT, STRICT, GOVERNMENT, BANKING)
  it("should load all policy templates correctly", () => {
    const engine = new PolicyEngine();

    // DEFAULT_POLICY
    engine.loadPolicies(DEFAULT_POLICY.rules);
    const defaultDecision = engine.evaluate(
      "backend-engineer",
      "read_file",
      makeContext(),
    );
    expect(defaultDecision.allowed).toBe(true);

    // STRICT_POLICY
    engine.loadPolicies(STRICT_POLICY.rules);
    const strictDecision = engine.evaluate(
      "backend-engineer",
      "web_search",
      makeContext(),
    );
    expect(strictDecision.effect).toBe("require_approval");

    // GOVERNMENT_POLICY
    engine.loadPolicies(GOVERNMENT_POLICY.rules);
    const govDecision = engine.evaluate(
      "backend-engineer",
      "write_file",
      makeContext(),
    );
    expect(govDecision.effect).toBe("require_approval");

    // BANKING_POLICY
    engine.loadPolicies(BANKING_POLICY.rules);
    const bankDecision = engine.evaluate(
      "backend-engineer",
      "process_payment",
      makeContext(),
    );
    expect(bankDecision.effect).toBe("require_approval");
  });
});

describe("Risk Assessment", () => {
  // Test 8: Risk assessment for various action types
  it("should assess risk levels correctly for different actions", () => {
    const context = makeContext();

    expect(assessRisk("external_api_call", context)).toBe("critical");
    expect(assessRisk("git_push", context)).toBe("critical");
    expect(assessRisk("deploy", context)).toBe("critical");
    expect(assessRisk("process_payment", context)).toBe("critical");
    expect(assessRisk("rm_rf", context)).toBe("high");
    expect(assessRisk("write_file", context)).toBe("medium");
    expect(assessRisk("web_search", context)).toBe("low");
    expect(assessRisk("read_file", context)).toBe("low");
    expect(assessRisk("query", context)).toBe("low");
    expect(assessRisk("list_files", context)).toBe("low");
  });
});

describe("Governance Context", () => {
  // Test 9: Governance context propagation
  it("should propagate governance context correctly", () => {
    const engine = new PolicyEngine();
    engine.addPolicy(
      makeRule({
        id: "depth-limited",
        name: "Depth limited action",
        subjects: ["ceo"],
        actions: ["external_api_call"],
        effect: "allow",
        conditions: [
          { type: "delegation_depth", params: { max: 2 } },
        ],
        priority: 10,
      }),
    );

    // Within depth limit
    const okDecision = engine.evaluate(
      "ceo",
      "external_api_call",
      makeContext({ delegationDepth: 1 }),
    );
    expect(okDecision.allowed).toBe(true);

    // At depth limit
    const atLimitDecision = engine.evaluate(
      "ceo",
      "external_api_call",
      makeContext({ delegationDepth: 2 }),
    );
    expect(atLimitDecision.allowed).toBe(true);

    // Beyond depth limit
    const overLimitDecision = engine.evaluate(
      "ceo",
      "external_api_call",
      makeContext({ delegationDepth: 3 }),
    );
    expect(overLimitDecision.allowed).toBe(false);
  });
});

describe("Runtime Policy Management", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
  });

  // Test 10: Runtime policy addition and removal
  it("should support runtime policy addition and removal", () => {
    // Start with no policies - everything denied
    const initialDecision = engine.evaluate("backend-engineer", "read_file", makeContext());
    expect(initialDecision.allowed).toBe(false);
    expect(initialDecision.ruleId).toBe("default");

    // Add a policy
    engine.addPolicy(
      makeRule({
        id: "allow-read",
        name: "Allow read",
        subjects: ["backend-engineer"],
        actions: ["read_file"],
        effect: "allow",
        priority: 10,
      }),
    );

    const afterAdd = engine.evaluate("backend-engineer", "read_file", makeContext());
    expect(afterAdd.allowed).toBe(true);
    expect(afterAdd.ruleId).toBe("allow-read");

    // Remove the policy
    const removed = engine.removePolicy("allow-read");
    expect(removed).toBe(true);

    const afterRemove = engine.evaluate("backend-engineer", "read_file", makeContext());
    expect(afterRemove.allowed).toBe(false);
    expect(afterRemove.ruleId).toBe("default");

    // Removing non-existent policy returns false
    const notFound = engine.removePolicy("nonexistent");
    expect(notFound).toBe(false);
  });
});

// Additional tests for delegation chain building and agent action plan risk

describe("buildDelegationChain", () => {
  it("should build a delegation chain from logs", () => {
    const chain = buildDelegationChain([
      {
        timestamp: "2026-01-01T00:00:00Z",
        from: "ceo" as AgentRole,
        to: "cto" as AgentRole,
        action: "spawn",
        summary: "CEO spawns CTO",
      },
      {
        timestamp: "2026-01-01T00:01:00Z",
        from: "cto" as AgentRole,
        to: "backend-engineer" as AgentRole,
        action: "spawn",
        summary: "CTO spawns backend engineer",
      },
    ]);

    expect(chain.depth).toBe(2);
    expect(chain.rootDelegator).toBe("ceo");
    expect(chain.leafAgent).toBe("backend-engineer");
    expect(chain.entries.length).toBe(2);
  });

  it("should handle empty logs", () => {
    const chain = buildDelegationChain([]);
    expect(chain.depth).toBe(0);
    expect(chain.entries.length).toBe(0);
  });
});

describe("assessAgentActionPlan", () => {
  it("should return minimal for empty results", () => {
    expect(assessAgentActionPlan([])).toBe("minimal");
  });

  it("should assess risk from failed agent results", () => {
    const results: AgentResult[] = [
      makeResult({
        role: "devops-agent",
        status: "failed",
      }),
    ];
    const risk = assessAgentActionPlan(results);
    expect(risk).toBe("medium");
  });

  it("should assess high risk from mixed failures and partials", () => {
    const results: AgentResult[] = [
      makeResult({ role: "devops-agent", status: "failed" }),
      makeResult({ role: "backend-engineer", status: "partial" }),
    ];
    const risk = assessAgentActionPlan(results);
    expect(risk).toBe("high");
  });
});
