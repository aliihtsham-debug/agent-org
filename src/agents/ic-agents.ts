import type { AgentRole, AgentResult, TaskSpec } from "../types/agent-types.js";
import { ROLE_OUTPUT_DIR } from "../types/agent-types.js";
import { runAgentWithRetry, type AgentContext } from "./base-agent.js";

/**
 * All IC (Individual Contributor) roles across every branch.
 * These are leaf agents — they produce output but never spawn children.
 */
export type ICRole =
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
  // Phase 3 — PM sub-agents
  | "ux-researcher"
  | "roadmap-agent"
  | "analytics-agent";

/** Subdirectory for a given IC role, sourced from the shared ROLE_OUTPUT_DIR. */
function outputDir(role: ICRole): string {
  return ROLE_OUTPUT_DIR[role];
}

export function createICTask(
  role: ICRole,
  idea: string,
  architectureSummary: string,
  productSummary: string,
  outputBase: string,
  extraContext = "",
): TaskSpec {
  const id = `${role}-${Date.now()}`;
  const subdir = outputDir(role);
  const outputPath = `${outputBase}/${subdir}/${role}`;

  let task: string;
  switch (role) {
    // ── Engineering ──────────────────────────────────────────────────
    case "frontend-engineer":
      task = `Build the frontend scaffold for: "${idea}"`;
      break;
    case "backend-engineer":
      task = `Build the backend scaffold for: "${idea}"`;
      break;
    case "ai-engineer":
      task = `Build the AI/ML integration scaffold for: "${idea}"`;
      break;
    case "devops-agent":
      task = `Create the DevOps/deployment plan for: "${idea}"`;
      break;
    // ── QA ───────────────────────────────────────────────────────────
    case "testing-agent":
      task = `Create a test plan and example tests for: "${idea}"`;
      break;
    case "performance-agent":
      task = `Create a performance testing and optimization plan for: "${idea}"`;
      break;
    // ── Security ─────────────────────────────────────────────────────
    case "security-auditor":
      task = `Perform a security audit and threat model for: "${idea}"`;
      break;
    case "vuln-scanner":
      task = `Perform a vulnerability scan and dependency audit for: "${idea}"`;
      break;
    case "compliance-agent":
      task = `Perform a compliance assessment for: "${idea}"`;
      break;
    // ── Finance ──────────────────────────────────────────────────────
    case "budget-agent":
      task = `Create a budget proposal and cost breakdown for: "${idea}"`;
      break;
    case "pricing-agent":
      task = `Create a pricing strategy and model for: "${idea}"`;
      break;
    // ── Operations ───────────────────────────────────────────────────
    case "scheduler-agent":
      task = `Create a project schedule and sprint plan for: "${idea}"`;
      break;
    case "workflow-agent":
      task = `Create a workflow specification and development process for: "${idea}"`;
      break;
    case "monitoring-agent":
      task = `Create a monitoring and alerting plan for: "${idea}"`;
      break;
    // ── PM sub-agents ─────────────────────────────────────────────────
    case "ux-researcher":
      task = `Create a UX research plan for: "${idea}"`;
      break;
    case "roadmap-agent":
      task = `Create a product roadmap for: "${idea}"`;
      break;
    case "analytics-agent":
      task = `Create an analytics and metrics plan for: "${idea}"`;
      break;
  }

  const contextParts = [
    architectureSummary ? `## Architecture Summary\n${architectureSummary}` : "",
    productSummary ? `## Product Summary\n${productSummary}` : "",
    extraContext ? `## Additional Context\n${extraContext}` : "",
  ].filter(Boolean);

  return {
    id,
    role,
    task,
    context: contextParts.join("\n\n"),
    outputPath,
  };
}

export async function runICAgent(
  role: ICRole,
  idea: string,
  ctx: AgentContext,
  architectureSummary = "",
  productSummary = "",
  extraContext = "",
): Promise<AgentResult> {
  const task = createICTask(role, idea, architectureSummary, productSummary, ctx.outputBase, extraContext);
  return runAgentWithRetry(task, ctx);
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
  const roles: ICRole[] = ["frontend-engineer", "backend-engineer", "ai-engineer", "devops-agent"];
  return Promise.all(
    roles.map((role) => runICAgent(role, idea, ctx, archSummary, productSummary, engPlanSummary)),
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
  const roles: ICRole[] = ["testing-agent", "performance-agent"];
  return Promise.all(
    roles.map((role) => runICAgent(role, idea, ctx, archSummary, productSummary, qaStrategySummary)),
  );
}

/** Security ICs: spawned by CISO */
export async function runSecurityICs(
  idea: string,
  ctx: AgentContext,
  securityStrategySummary: string,
): Promise<AgentResult[]> {
  const roles: ICRole[] = ["security-auditor", "vuln-scanner", "compliance-agent"];
  return Promise.all(
    roles.map((role) => runICAgent(role, idea, ctx, "", "", securityStrategySummary)),
  );
}

/** Finance ICs: spawned by CFO */
export async function runFinanceICs(
  idea: string,
  ctx: AgentContext,
  financialSummary: string,
): Promise<AgentResult[]> {
  const roles: ICRole[] = ["budget-agent", "pricing-agent"];
  return Promise.all(
    roles.map((role) => runICAgent(role, idea, ctx, "", "", financialSummary)),
  );
}

/** Operations ICs: spawned by COO */
export async function runOperationsICs(
  idea: string,
  ctx: AgentContext,
  opsSummary: string,
): Promise<AgentResult[]> {
  const roles: ICRole[] = ["scheduler-agent", "workflow-agent", "monitoring-agent"];
  return Promise.all(
    roles.map((role) => runICAgent(role, idea, ctx, "", "", opsSummary)),
  );
}

/** PM ICs: spawned by PM Agent */
export async function runPMICs(
  idea: string,
  ctx: AgentContext,
  productStrategySummary: string,
): Promise<AgentResult[]> {
  const roles: ICRole[] = ["ux-researcher", "roadmap-agent", "analytics-agent"];
  return Promise.all(
    roles.map((role) => runICAgent(role, idea, ctx, "", "", productStrategySummary)),
  );
}
