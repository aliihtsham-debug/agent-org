export type AgentRole =
  | "ceo"
  | "cto"
  | "pm"
  | "frontend-engineer"
  | "backend-engineer"
  | "testing-agent"
  | "security-auditor"
  | "devops-agent"
  // Phase 2 — Management layer
  | "engineering-manager"
  | "qa-manager"
  | "ai-engineer"
  | "performance-agent"
  // Phase 2 — CISO branch
  | "ciso"
  | "vuln-scanner"
  | "compliance-agent"
  // Phase 2 — CFO branch
  | "cfo"
  | "budget-agent"
  | "pricing-agent"
  // Phase 2 — COO branch
  | "coo"
  | "scheduler-agent"
  | "workflow-agent"
  | "monitoring-agent"
  // Phase 3 — PM sub-agents
  | "ux-researcher"
  | "roadmap-agent"
  | "analytics-agent";

export type AgentStatus = "pending" | "in_progress" | "completed" | "failed" | "partial";

export interface TaskSpec {
  id: string;
  role: AgentRole;
  task: string;
  context: string;
  outputPath: string;
  retryCount?: number;
  previousError?: string;
}

export interface AgentResult {
  role: AgentRole;
  status: AgentStatus;
  outputPath: string;
  summary: string;
  artifacts: string[];
  tokenUsage: {
    input: number;
    output: number;
  };
  durationMs: number;
  error?: string;
  /** IC results aggregated from sub-agents (used by orchestrator agents) */
  icResults?: AgentResult[];
}

export interface ProjectPlan {
  idea: string;
  timestamp: string;
  pmResult: AgentResult;
  ctoResult: AgentResult;
  cisoResult: AgentResult;
  cfoResult: AgentResult;
  cooResult: AgentResult;
  icResults: AgentResult[];
  status: "complete" | "partial" | "failed";
  gaps: string[];
}

export interface DelegationLog {
  timestamp: string;
  from: AgentRole;
  to: AgentRole;
  action: "spawn" | "retry" | "complete" | "fail";
  summary: string;
}

/**
 * Shared mapping from every agent role to its output subdirectory.
 * Single source of truth — used by ic-agents.ts, ceo-agent.ts, and git-commit.ts.
 */
export const ROLE_OUTPUT_DIR: Record<AgentRole, string> = {
  ceo: "ceo",
  cto: "architecture/cto",
  pm: "specs/pm",
  "frontend-engineer": "code/frontend",
  "backend-engineer": "code/backend",
  "testing-agent": "tests/testing-agent",
  "security-auditor": "security/security-auditor",
  "devops-agent": "code/devops",
  // Management layer
  "engineering-manager": "architecture/eng-manager",
  "qa-manager": "tests/qa-manager",
  "ai-engineer": "code/ai",
  "performance-agent": "tests/performance",
  // CISO branch
  ciso: "security/ciso",
  "vuln-scanner": "security/vuln-scanner",
  "compliance-agent": "security/compliance",
  // CFO branch
  cfo: "finance/cfo",
  "budget-agent": "finance/budget",
  "pricing-agent": "finance/pricing",
  // COO branch
  coo: "operations/coo",
  "scheduler-agent": "operations/scheduler",
  "workflow-agent": "operations/workflow",
  "monitoring-agent": "operations/monitoring",
  // Phase 3 — PM sub-agents
  "ux-researcher": "specs/ux-research",
  "roadmap-agent": "specs/roadmap",
  "analytics-agent": "specs/analytics",
};
