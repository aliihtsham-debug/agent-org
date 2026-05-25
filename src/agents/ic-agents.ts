import type { AgentRole, AgentResult, TaskSpec } from "../types/agent-types.js";
import { runAgentWithRetry, type AgentContext } from "./base-agent.js";

export type ICRole =
  | "frontend-engineer"
  | "backend-engineer"
  | "testing-agent"
  | "security-auditor"
  | "devops-agent";

const IC_OUTPUT_DIRS: Record<ICRole, string> = {
  "frontend-engineer": "code/frontend",
  "backend-engineer": "code/backend",
  "testing-agent": "tests",
  "security-auditor": "security",
  "devops-agent": "code/devops",
};

export function createICTask(
  role: ICRole,
  idea: string,
  architectureSummary: string,
  productSummary: string,
  outputBase: string,
): TaskSpec {
  const id = `${role}-${Date.now()}`;
  const subdir = IC_OUTPUT_DIRS[role];
  const outputPath = `${outputBase}/${subdir}/${role}`;

  let task: string;
  switch (role) {
    case "frontend-engineer":
      task = `Build the frontend scaffold for this product idea: "${idea}"`;
      break;
    case "backend-engineer":
      task = `Build the backend scaffold for this product idea: "${idea}"`;
      break;
    case "testing-agent":
      task = `Create a test plan and example tests for this product idea: "${idea}"`;
      break;
    case "security-auditor":
      task = `Perform a security audit for this product idea: "${idea}"`;
      break;
    case "devops-agent":
      task = `Create a DevOps/deployment plan for this product idea: "${idea}"`;
      break;
  }

  return {
    id,
    role,
    task,
    context: `## Architecture Summary\n${architectureSummary}\n\n## Product Summary\n${productSummary}`,
    outputPath,
  };
}

export async function runICAgent(
  role: ICRole,
  idea: string,
  ctx: AgentContext,
  architectureSummary = "",
  productSummary = "",
): Promise<AgentResult> {
  const task = createICTask(role, idea, architectureSummary, productSummary, ctx.outputBase);
  return runAgentWithRetry(task, ctx);
}

export async function runAllICAgents(
  idea: string,
  ctx: AgentContext,
  architectureSummary: string,
  productSummary: string,
): Promise<AgentResult[]> {
  const roles: ICRole[] = [
    "frontend-engineer",
    "backend-engineer",
    "testing-agent",
    "security-auditor",
    "devops-agent",
  ];

  const promises = roles.map((role) =>
    runICAgent(role, idea, ctx, architectureSummary, productSummary),
  );

  return Promise.all(promises);
}
