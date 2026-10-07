import type { AgentRole, AgentResult, TaskSpec } from "../types/agent-types.js";
import { ROLE_OUTPUT_DIR } from "../types/agent-types.js";
import { runAgentWithRetry, type AgentContext, withEnterpriseIC } from "./base-agent.js";

/**
 * All IC (Individual Contributor) roles across every branch.
 * These are leaf agents — they produce output but never spawn children.
 */
type ICRole =
  // Engineering
  | "frontend-engineer"
  | "backend-engineer"
  | "ai-engineer"
  | "devops-agent"
  // QA
  | "testing-agent"
  | "performance-agent"
  // Security
  | "security-auditor"
  | "vuln-scanner"
  | "compliance-agent"
  // Finance
  | "budget-agent"
  | "pricing-agent"
  // Operations
  | "scheduler-agent"
  | "workflow-agent"
  | "monitoring-agent"
  // PM sub-agents
  | "ux-researcher"
  | "roadmap-agent"
  | "analytics-agent";

/** Task description templates per IC role. */
const IC_TASK_TEMPLATES: Record<ICRole, string> = {
  "frontend-engineer": "Build the frontend scaffold for",
  "backend-engineer": "Build the backend scaffold for",
  "ai-engineer": "Build the AI/ML integration scaffold for",
  "devops-agent": "Create the DevOps/deployment plan for",
  "testing-agent": "Create a test plan and example tests for",
  "performance-agent": "Create a performance testing and optimization plan for",
  "security-auditor": "Perform a security audit and threat model for",
  "vuln-scanner": "Perform a vulnerability scan and dependency audit for",
  "compliance-agent": "Perform a compliance assessment for",
  "budget-agent": "Create a budget proposal and cost breakdown for",
  "pricing-agent": "Create a pricing strategy and model for",
  "scheduler-agent": "Create a project schedule and sprint plan for",
  "workflow-agent": "Create a workflow specification and development process for",
  "monitoring-agent": "Create a monitoring and alerting plan for",
  "ux-researcher": "Create a UX research plan for",
  "roadmap-agent": "Create a product roadmap for",
  "analytics-agent": "Create an analytics and metrics plan for",
};

/** Generic branch IC spawner — uses shared enterprise helper. */
async function runBranchICs(
  roles: ICRole[],
  idea: string,
  ctx: AgentContext,
  summaries: { arch?: string; product?: string; extra?: string },
): Promise<AgentResult[]> {
  return Promise.all(
    roles.map((role) =>
      withEnterpriseIC(idea, ctx, {
        role,
        displayName: `${role} Agent`,
        taskTemplate: IC_TASK_TEMPLATES[role],
        architectureSummary: summaries.arch ?? "",
        productSummary: summaries.product ?? "",
        extraContext: summaries.extra ?? "",
      }),
    ),
  );
}

// ── Branch-specific spawn functions ─────────────────────────────────────

/** Engineering ICs: spawned by Engineering Manager */
export async function runEngineeringICs(
  idea: string,
  ctx: AgentContext,
  archSummary: string,
  productSummary: string,
  engPlanSummary: string,
): Promise<AgentResult[]> {
  return runBranchICs(
    ["frontend-engineer", "backend-engineer", "ai-engineer", "devops-agent"],
    idea, ctx, { arch: archSummary, product: productSummary, extra: engPlanSummary },
  );
}

/** QA ICs: spawned by QA Manager */
export async function runQAICs(
  idea: string,
  ctx: AgentContext,
  archSummary: string,
  productSummary: string,
  qaStrategySummary: string,
): Promise<AgentResult[]> {
  return runBranchICs(
    ["testing-agent", "performance-agent"],
    idea, ctx, { arch: archSummary, product: productSummary, extra: qaStrategySummary },
  );
}

/** Security ICs: spawned by CISO */
export async function runSecurityICs(
  idea: string,
  ctx: AgentContext,
  securityStrategySummary: string,
): Promise<AgentResult[]> {
  return runBranchICs(
    ["security-auditor", "vuln-scanner", "compliance-agent"],
    idea, ctx, { extra: securityStrategySummary },
  );
}

/** Finance ICs: spawned by CFO */
export async function runFinanceICs(
  idea: string,
  ctx: AgentContext,
  financialSummary: string,
): Promise<AgentResult[]> {
  return runBranchICs(
    ["budget-agent", "pricing-agent"],
    idea, ctx, { extra: financialSummary },
  );
}

/** Operations ICs: spawned by COO */
export async function runOperationsICs(
  idea: string,
  ctx: AgentContext,
  opsSummary: string,
): Promise<AgentResult[]> {
  return runBranchICs(
    ["scheduler-agent", "workflow-agent", "monitoring-agent"],
    idea, ctx, { extra: opsSummary },
  );
}

/** PM ICs: spawned by PM Agent */
export async function runPMICs(
  idea: string,
  ctx: AgentContext,
  productStrategySummary: string,
): Promise<AgentResult[]> {
  return runBranchICs(
    ["ux-researcher", "roadmap-agent", "analytics-agent"],
    idea, ctx, { extra: productStrategySummary },
  );
}
