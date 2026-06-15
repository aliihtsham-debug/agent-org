/**
 * Phase 15 — Government Workflow Template
 *
 * FedRAMP / NIST 800-53 aligned governance template.
 */

import type { GovernanceTemplate } from "../types/governance-types.js";

export const GOVERNMENT_WORKFLOW: GovernanceTemplate = {
  name: "Government Workflow",
  description:
    "FedRAMP and NIST 800-53 aligned governance. Dual approval required for all external actions. Full audit trail. No autonomous writes.",
  rules: [
    {
      name: "allow-reads",
      description: "Allow read operations within output directory",
      effect: "allow",
      subjects: ["*"],
      actions: ["read", "list"],
      priority: 10,
      conditions: [],
    },
    {
      name: "require-dual-approval-all",
      description: "All writes and external actions require dual approval",
      effect: "require_approval",
      subjects: ["*"],
      actions: ["write_file", "create_dir", "web_search", "git_push", "git_commit", "linear_sync", "external_api"],
      priority: 50,
      conditions: [],
    },
    {
      name: "deny-shell",
      description: "Deny shell command execution",
      effect: "deny",
      subjects: ["*"],
      actions: ["shell_exec", "exec_command"],
      priority: 100,
      conditions: [],
    },
    {
      name: "deny-autonomous-external",
      description: "Deny autonomous external API writes",
      effect: "deny",
      subjects: ["*"],
      actions: ["linear_sync", "external_api"],
      priority: 90,
      conditions: [],
    },
  ],
  approvalMatrix: {
    critical: { approvers: ["ceo", "ciso"], minApprovals: 2 },
    high: { approvers: ["ceo", "ciso"], minApprovals: 2 },
    medium: { approvers: ["ceo"], minApprovals: 1 },
    low: { approvers: ["ceo"], minApprovals: 1 },
  },
};
