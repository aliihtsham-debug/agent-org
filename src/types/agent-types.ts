export type AgentRole =
  | "ceo"
  | "cto"
  | "pm"
  | "frontend-engineer"
  | "backend-engineer"
  | "testing-agent"
  | "security-auditor"
  | "devops-agent";

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
}

export interface ProjectPlan {
  idea: string;
  timestamp: string;
  pmResult: AgentResult;
  ctoResult: AgentResult;
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
