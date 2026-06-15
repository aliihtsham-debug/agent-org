/**
 * Phase 16 — Enterprise Workflow Templates
 */

import type { WorkflowTemplate } from "../types/marketplace-types.js";

export const FEATURE_LAUNCH_PIPELINE: WorkflowTemplate = {
  id: "feature-launch",
  name: "Feature Launch Pipeline",
  description: "Idea → Design → Build → Test → Deploy",
  steps: [
    { order: 1, name: "Product Design", agentRole: "pm", description: "Define feature requirements and user stories" },
    { order: 2, name: "Architecture Design", agentRole: "cto", description: "Design technical architecture" },
    { order: 3, name: "Implementation", agentRole: "backend-engineer", description: "Build the feature" },
    { order: 4, name: "Testing", agentRole: "testing-agent", description: "Test the implementation" },
    { order: 5, name: "Security Review", agentRole: "security-auditor", description: "Security review of the feature" },
    { order: 6, name: "Deployment", agentRole: "devops-agent", description: "Deploy to production" },
  ],
  tags: ["feature", "launch", "pipeline"],
};

export const SECURITY_AUDIT_WORKFLOW: WorkflowTemplate = {
  id: "security-audit",
  name: "Security Audit Workflow",
  description: "Full security review cycle",
  steps: [
    { order: 1, name: "Vulnerability Scan", agentRole: "vuln-scanner", description: "Scan for vulnerabilities" },
    { order: 2, name: "Security Audit", agentRole: "security-auditor", description: "Manual security review" },
    { order: 3, name: "Compliance Check", agentRole: "compliance-agent", description: "Verify compliance requirements" },
    { order: 4, name: "Remediation Plan", agentRole: "cto", description: "Plan remediation steps" },
  ],
  tags: ["security", "audit"],
};

export const COMPLIANCE_REVIEW_CYCLE: WorkflowTemplate = {
  id: "compliance-review",
  name: "Compliance Review Cycle",
  description: "Periodic compliance check",
  steps: [
    { order: 1, name: "Policy Review", agentRole: "compliance-agent", description: "Review current policies" },
    { order: 2, name: "Gap Analysis", agentRole: "security-auditor", description: "Identify compliance gaps" },
    { order: 3, name: "Remediation", agentRole: "cto", description: "Implement fixes" },
    { order: 4, name: "Audit Report", agentRole: "cfo", description: "Generate compliance report" },
  ],
  tags: ["compliance", "review"],
};

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  FEATURE_LAUNCH_PIPELINE,
  SECURITY_AUDIT_WORKFLOW,
  COMPLIANCE_REVIEW_CYCLE,
];
