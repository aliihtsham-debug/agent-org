/** Structured output from the Linear Mapper Agent — ready for API calls. */
export interface LinearImport {
  projectName: string;
  projectDescription: string;
  labels: string[];
  cycles: LinearCycleInput[];
  issues: LinearIssueInput[];
  metadata: {
    agentCount: number;
    tokenUsage: { input: number; output: number };
    durationMs: number;
    timestamp: string;
    icSummaries: { role: string; summary: string }[];
  };
}

export interface LinearIssueInput {
  title: string;
  description: string;
  labels: string[];
  priority: "urgent" | "high" | "medium" | "low" | "none";
  cycleName?: string;
}

export interface LinearCycleInput {
  name: string;
  startsAt: string;
  endsAt: string;
}

/** Result from syncing to Linear. */
export interface LinearSyncResult {
  projectUrl: string | null;
  issueUrls: string[];
  cycleUrls: string[];
  labelIds: string[];
  created: number;
  skipped: number;
  errors: string[];
}

/** Result from the mapper agent. */
export interface LinearMapperResult {
  success: boolean;
  import: LinearImport | null;
  outputPath: string;
  error?: string;
}
