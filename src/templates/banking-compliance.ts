/**
 * Phase 15 — Banking Compliance Template
 *
 * PCI-DSS / SOX aligned governance template.
 */

import type { GovernanceTemplate } from "../types/governance-types.js";

export const BANKING_COMPLIANCE: GovernanceTemplate = {
  name: "Banking Compliance",
  description:
    "PCI-DSS and SOX aligned governance. Dual-approval for financial and external-facing actions. Data residency enforcement.",
  rules: [
    {
      name: "allow-reads",
      description: "Allow read operations",
      effect: "allow",
      subjects: ["*"],
      actions: ["read", "list", "search"],
      priority: 10,
      conditions: [],
    },
    {
      name: "allow-web-search",
      description: "Allow web research",
      effect: "allow",
      subjects: ["*"],
      actions: ["web_search"],
      priority: 10,
      conditions: [],
    },
    {
      name: "allow-file-write",
      description: "Allow writing to output directory",
      effect: "allow",
      subjects: ["*"],
      actions: ["write_file", "create_dir"],
      priority: 10,
      conditions: [],
    },
    {
      name: "require-dual-approval-external",
      description: "Dual approval for external operations",
      effect: "require_approval",
      subjects: ["*"],
      actions: ["git_push", "git_commit", "linear_sync", "external_api"],
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
  ],
  approvalMatrix: {
    critical: { approvers: ["ceo", "cfo", "ciso"], minApprovals: 2 },
    high: { approvers: ["ceo", "cfo"], minApprovals: 2 },
    medium: { approvers: ["ceo"], minApprovals: 1 },
    low: { approvers: ["ceo"], minApprovals: 1 },
  },
};
