import type {
  PolicyRule,
  GovernanceTemplate,
  ApprovalMatrix,
} from "../types/governance-types.js";
import type { AgentRole } from "../types/agent-types.js";

// -- Shared helpers --

const NOW = new Date().toISOString();

function makeRule(partial: Partial<PolicyRule> & { id: string; name: string }): PolicyRule {
  return {
    description: "",
    effect: "allow",
    subjects: [],
    actions: [],
    priority: 100,
    createdAt: NOW,
    ...partial,
  };
}

// -- Approval Matrices --

const ENTERPRISE_APPROVAL_MATRIX: ApprovalMatrix = {
  critical: {
    approvers: ["ceo", "ciso"],
    minApprovals: 2,
  },
  high: {
    approvers: ["ceo", "cto", "ciso"],
    minApprovals: 1,
  },
  medium: {
    approvers: ["cto", "engineering-manager"],
    minApprovals: 1,
  },
  low: {
    approvers: ["engineering-manager"],
    minApprovals: 1,
  },
};

const STRICT_APPROVAL_MATRIX: ApprovalMatrix = {
  critical: {
    approvers: ["ceo", "ciso"],
    minApprovals: 2,
  },
  high: {
    approvers: ["ceo", "ciso"],
    minApprovals: 2,
  },
  medium: {
    approvers: ["ceo", "cto"],
    minApprovals: 1,
  },
  low: {
    approvers: ["cto", "engineering-manager"],
    minApprovals: 1,
  },
};

const GOVERNMENT_APPROVAL_MATRIX: ApprovalMatrix = {
  critical: {
    approvers: ["ceo", "ciso", "compliance-agent"],
    minApprovals: 3,
  },
  high: {
    approvers: ["ceo", "ciso", "compliance-agent"],
    minApprovals: 2,
  },
  medium: {
    approvers: ["ciso", "compliance-agent"],
    minApprovals: 2,
  },
  low: {
    approvers: ["compliance-agent"],
    minApprovals: 1,
  },
};

const BANKING_APPROVAL_MATRIX: ApprovalMatrix = {
  critical: {
    approvers: ["ceo", "cfo", "ciso"],
    minApprovals: 3,
  },
  high: {
    approvers: ["ceo", "cfo", "ciso"],
    minApprovals: 2,
  },
  medium: {
    approvers: ["cfo", "ciso"],
    minApprovals: 1,
  },
  low: {
    approvers: ["cfo"],
    minApprovals: 1,
  },
};

// -- All agent roles wildcard --

const ALL_ROLES: AgentRole[] = [
  "ceo", "cto", "pm", "frontend-engineer", "backend-engineer",
  "testing-agent", "security-auditor", "devops-agent",
  "engineering-manager", "qa-manager", "ai-engineer", "performance-agent",
  "ciso", "vuln-scanner", "compliance-agent",
  "cfo", "budget-agent", "pricing-agent",
  "coo", "scheduler-agent", "workflow-agent", "monitoring-agent",
  "ux-researcher", "roadmap-agent", "analytics-agent",
  "linear-mapper",
];

// -- DEFAULT_POLICY --

const DEFAULT_POLICY_RULES: PolicyRule[] = [
  makeRule({
    id: "default-allow-read",
    name: "Allow read actions",
    description: "All agents may perform read actions",
    effect: "allow",
    subjects: ALL_ROLES,
    actions: ["read_file", "list_files", "search_code", "query"],
    priority: 10,
  }),
  makeRule({
    id: "default-allow-internal-write",
    name: "Allow internal writes",
    description: "All agents may write to internal outputs",
    effect: "allow",
    subjects: ALL_ROLES,
    actions: ["write_file", "create_artifact", "update_status"],
    resources: ["outputs/*", "internal/*"],
    priority: 10,
  }),
  makeRule({
    id: "default-require-approval-external",
    name: "Require approval for external writes",
    description: "External API calls and git pushes require approval",
    effect: "require_approval",
    subjects: ALL_ROLES,
    actions: ["external_api_call", "git_push", "deploy", "publish"],
    priority: 50,
  }),
  makeRule({
    id: "default-deny-dangerous",
    name: "Deny dangerous actions",
    description: "Destructive actions are denied by default",
    effect: "deny",
    subjects: ALL_ROLES,
    actions: ["delete_database", "drop_table", "rm_rf", "format_disk"],
    priority: 100,
  }),
  makeRule({
    id: "default-allow-web-search",
    name: "Allow web search",
    description: "All agents may perform web searches",
    effect: "allow",
    subjects: ALL_ROLES,
    actions: ["web_search", "web_fetch"],
    priority: 10,
  }),
];

export const DEFAULT_POLICY: GovernanceTemplate = {
  name: "Default Enterprise Policy",
  description: "Standard enterprise policy: allow most actions, require approval for external writes",
  rules: DEFAULT_POLICY_RULES,
  approvalMatrix: ENTERPRISE_APPROVAL_MATRIX,
};

// -- STRICT_POLICY --

const STRICT_POLICY_RULES: PolicyRule[] = [
  makeRule({
    id: "strict-allow-read",
    name: "Allow read actions",
    description: "All agents may perform read actions",
    effect: "allow",
    subjects: ALL_ROLES,
    actions: ["read_file", "list_files", "search_code", "query"],
    priority: 10,
  }),
  makeRule({
    id: "strict-require-approval-external",
    name: "Require approval for all external actions",
    description: "All external-facing actions require approval",
    effect: "require_approval",
    subjects: ALL_ROLES,
    actions: ["external_api_call", "git_push", "deploy", "publish", "write_file", "create_artifact"],
    resources: ["external/*", "prod/*"],
    priority: 50,
  }),
  makeRule({
    id: "strict-allow-internal-write",
    name: "Allow internal writes with conditions",
    description: "Internal writes allowed only within business hours",
    effect: "allow",
    subjects: ALL_ROLES,
    actions: ["write_file", "create_artifact"],
    resources: ["outputs/*", "internal/*"],
    conditions: [
      {
        type: "time_window",
        params: { startHour: 8, endHour: 18 },
      },
    ],
    priority: 20,
  }),
  makeRule({
    id: "strict-deny-dangerous",
    name: "Deny dangerous actions",
    description: "Destructive actions are denied",
    effect: "deny",
    subjects: ALL_ROLES,
    actions: ["delete_database", "drop_table", "rm_rf", "format_disk"],
    priority: 100,
  }),
  makeRule({
    id: "strict-require-approval-web",
    name: "Require approval for web access",
    description: "Web search and fetch require approval",
    effect: "require_approval",
    subjects: ALL_ROLES,
    actions: ["web_search", "web_fetch"],
    priority: 50,
  }),
];

export const STRICT_POLICY: GovernanceTemplate = {
  name: "Strict Policy",
  description: "Strict policy: all external actions require approval, time-based restrictions on writes",
  rules: STRICT_POLICY_RULES,
  approvalMatrix: STRICT_APPROVAL_MATRIX,
};

// -- GOVERNMENT_POLICY --

const GOVERNMENT_POLICY_RULES: PolicyRule[] = [
  makeRule({
    id: "gov-allow-read",
    name: "Allow read actions",
    description: "All agents may perform read actions",
    effect: "allow",
    subjects: ALL_ROLES,
    actions: ["read_file", "list_files", "search_code", "query"],
    priority: 10,
  }),
  makeRule({
    id: "gov-require-approval-all-writes",
    name: "Require approval for all writes",
    description: "All write actions require approval from compliance",
    effect: "require_approval",
    subjects: ALL_ROLES,
    actions: ["write_file", "create_artifact", "update_status", "external_api_call", "git_push", "deploy", "publish"],
    priority: 50,
  }),
  makeRule({
    id: "gov-require-approval-web",
    name: "Require approval for web access",
    description: "Web access requires compliance approval",
    effect: "require_approval",
    subjects: ALL_ROLES,
    actions: ["web_search", "web_fetch"],
    priority: 50,
  }),
  makeRule({
    id: "gov-deny-dangerous",
    name: "Deny dangerous actions",
    description: "Destructive actions are denied",
    effect: "deny",
    subjects: ALL_ROLES,
    actions: ["delete_database", "drop_table", "rm_rf", "format_disk"],
    priority: 100,
  }),
  makeRule({
    id: "gov-allow-internal-read-only",
    name: "Allow internal read-only operations",
    description: "Internal read operations are allowed",
    effect: "allow",
    subjects: ALL_ROLES,
    actions: ["list_files", "query"],
    resources: ["internal/*"],
    priority: 10,
  }),
];

export const GOVERNMENT_POLICY: GovernanceTemplate = {
  name: "Government Policy",
  description: "Government-grade policy: full approval chain, no autonomous external writes",
  rules: GOVERNMENT_POLICY_RULES,
  approvalMatrix: GOVERNMENT_APPROVAL_MATRIX,
};

// -- BANKING_POLICY --

const BANKING_POLICY_RULES: PolicyRule[] = [
  makeRule({
    id: "bank-allow-read",
    name: "Allow read actions",
    description: "All agents may perform read actions",
    effect: "allow",
    subjects: ALL_ROLES,
    actions: ["read_file", "list_files", "search_code", "query"],
    priority: 10,
  }),
  makeRule({
    id: "bank-allow-internal-write",
    name: "Allow internal writes",
    description: "Internal writes are allowed",
    effect: "allow",
    subjects: ALL_ROLES,
    actions: ["write_file", "create_artifact", "update_status"],
    resources: ["outputs/*", "internal/*"],
    priority: 10,
  }),
  makeRule({
    id: "bank-dual-approval-financial",
    name: "Dual approval for financial actions",
    description: "Financial actions require dual approval from CFO and CISO",
    effect: "require_approval",
    subjects: ALL_ROLES,
    actions: ["process_payment", "transfer_funds", "modify_pricing", "update_budget"],
    priority: 60,
  }),
  makeRule({
    id: "bank-require-approval-external",
    name: "Require approval for external writes",
    description: "External API calls and deployments require approval",
    effect: "require_approval",
    subjects: ALL_ROLES,
    actions: ["external_api_call", "git_push", "deploy", "publish"],
    priority: 50,
  }),
  makeRule({
    id: "bank-deny-dangerous",
    name: "Deny dangerous actions",
    description: "Destructive actions are denied",
    effect: "deny",
    subjects: ALL_ROLES,
    actions: ["delete_database", "drop_table", "rm_rf", "format_disk"],
    priority: 100,
  }),
  makeRule({
    id: "bank-allow-web-search",
    name: "Allow web search",
    description: "Web search is allowed for research",
    effect: "allow",
    subjects: ALL_ROLES,
    actions: ["web_search", "web_fetch"],
    priority: 10,
  }),
];

export const BANKING_POLICY: GovernanceTemplate = {
  name: "Banking Compliance Policy",
  description: "Banking policy: dual-approval for financial and external actions",
  rules: BANKING_POLICY_RULES,
  approvalMatrix: BANKING_APPROVAL_MATRIX,
};

// -- Export all templates --

export const ALL_TEMPLATES: Record<string, GovernanceTemplate> = {
  DEFAULT_POLICY,
  STRICT_POLICY,
  GOVERNMENT_POLICY,
  BANKING_POLICY,
};
