import type { LinearClient } from "@linear/sdk";
import type { AgentLogger } from "../observability/logger.js";
import type { LinearImport, LinearSyncResult, LinearIssueInput } from "./linear-types.js";
import type { ProjectPlan } from "../types/agent-types.js";
import { Semaphore } from "../utils/semaphore.js";

export interface LinearSyncOptions {
  apiKey: string;
  linearImport: LinearImport;
  project: ProjectPlan;
  logger: AgentLogger;
  /** Max concurrent Linear API calls (default: 3). */
  maxConcurrent?: number;
}

/**
 * Sync structured project data to Linear.
 *
 * Creates (in order): Labels → Project → Cycles → Issues.
 * Non-fatal: every operation is try/catched. Failures are logged as warnings.
 *
 * Authentication: API key only. The team is inferred from the key
 * (uses the first available team for the authenticated user).
 */
export async function syncToLinear(options: LinearSyncOptions): Promise<LinearSyncResult> {
  const { apiKey, linearImport, project, logger, maxConcurrent = 3 } = options;

  // Concurrency limiter for Linear API calls.
  // Linear's GraphQL API has rate limits; keeping this conservative (default 3)
  // avoids hitting them while still allowing some parallelism within each group.
  const sem = new Semaphore(maxConcurrent);

  const result: LinearSyncResult = {
    projectUrl: null,
    issueUrls: [],
    cycleUrls: [],
    labelIds: [],
    created: 0,
    skipped: 0,
    errors: [],
  };

  // Dynamic import so the module loads even if @linear/sdk is not installed
  let LinearClientClass: typeof LinearClient;
  try {
    const mod = await import("@linear/sdk");
    LinearClientClass = mod.LinearClient;
  } catch (err) {
    const msg = `@linear/sdk not installed. Run: npm install @linear/sdk`;
    logger.info(`Linear sync skipped: ${msg}`);
    result.errors.push(msg);
    return result;
  }

  const client = new LinearClientClass({ apiKey });

  // ── Step 1: Find team ──
  let teamId: string;
  try {
    const teams = await client.teams();
    const firstTeam = teams.nodes[0];
    if (!firstTeam) {
      const msg = "No teams found for this Linear API key";
      logger.info(`Linear sync skipped: ${msg}`);
      result.errors.push(msg);
      return result;
    }
    teamId = firstTeam.id;
    logger.info(`Linear sync: using team "${firstTeam.name}" (${teamId})`);
  } catch (err) {
    const msg = `Failed to fetch Linear teams: ${err instanceof Error ? err.message : String(err)}`;
    logger.info(`Linear sync skipped: ${msg}`);
    result.errors.push(msg);
    return result;
  }

  // ── Step 2: Create labels (parallel with concurrency limit) ──
  const labelIdMap = new Map<string, string>();
  const labelResults = await Promise.all(
    linearImport.labels.map((labelName) =>
      sem.run(async () => {
        try {
          const payload = await client.createIssueLabel({
            name: labelName,
            teamId,
            color: labelColor(labelName),
          });
          const label = await payload.issueLabel;
          if (label) {
            return { status: "created" as const, labelName, labelId: label.id };
          }
          return { status: "failed" as const, labelName, error: "No label returned" };
        } catch (err) {
          // Label may already exist — try to find it
          try {
            const existing = await client.issueLabels({ filter: { name: { eq: labelName } } });
            const found = existing.nodes[0];
            if (found) {
              return { status: "skipped" as const, labelName, labelId: found.id };
            }
            throw new Error("not found");
          } catch {
            return { status: "failed" as const, labelName, error: err instanceof Error ? err.message : String(err) };
          }
        }
      }),
    ),
  );
  for (const lr of labelResults) {
    if (lr.status === "created") {
      labelIdMap.set(lr.labelName, lr.labelId);
      result.labelIds.push(lr.labelId);
      result.created++;
    } else if (lr.status === "skipped") {
      labelIdMap.set(lr.labelName, lr.labelId);
      result.labelIds.push(lr.labelId);
      result.skipped++;
    } else {
      const msg = `Failed to create label "${lr.labelName}": ${lr.error}`;
      logger.info(`Linear sync warning: ${msg}`);
      result.errors.push(msg);
    }
  }

  // ── Step 3: Check for existing project (avoid duplicates) ──
  let projectId: string | null = null;
  try {
    const existingProjects = await client.projects({
      filter: { name: { eq: linearImport.projectName } },
    });
    const existing = existingProjects.nodes[0];
    if (existing) {
      projectId = existing.id;
      result.projectUrl = existing.url;
      logger.info(`Linear sync: reusing existing project "${linearImport.projectName}" (${existing.url})`);
    }
  } catch {
    // If we can't check, try to create anyway
  }

  // ── Step 4: Create project ──
  if (!projectId) {
    try {
      const payload = await client.createProject({
        name: linearImport.projectName,
        description: buildProjectDescription(linearImport, project),
        teamIds: [teamId],
        color: "#6366f1",
      });
      const createdProject = await payload.project;
      if (createdProject) {
        projectId = createdProject.id;
        result.projectUrl = createdProject.url;
        result.created++;
        logger.info(`Linear sync: created project "${linearImport.projectName}" (${createdProject.url})`);
      }
    } catch (err) {
      const msg = `Failed to create project: ${err instanceof Error ? err.message : String(err)}`;
      logger.info(`Linear sync warning: ${msg}`);
      result.errors.push(msg);
    }
  }

  // ── Step 5: Create cycles (parallel with concurrency limit) ──
  const cycleIdMap = new Map<string, string>();
  const cycleResults = await Promise.all(
    linearImport.cycles.map((cycle) =>
      sem.run(async () => {
        try {
          const payload = await client.createCycle({
            name: cycle.name,
            teamId,
            startsAt: new Date(cycle.startsAt),
            endsAt: new Date(cycle.endsAt),
          });
          const createdCycle = await payload.cycle;
          if (createdCycle) {
            return { status: "created" as const, cycleName: cycle.name, cycleId: createdCycle.id, number: createdCycle.number };
          }
          return { status: "failed" as const, cycleName: cycle.name, error: "No cycle returned" };
        } catch (err) {
          return { status: "failed" as const, cycleName: cycle.name, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    ),
  );
  for (const cr of cycleResults) {
    if (cr.status === "created") {
      cycleIdMap.set(cr.cycleName, cr.cycleId);
      result.cycleUrls.push(`https://linear.app/cycle/${cr.number}`);
      result.created++;
      logger.info(`Linear sync: created cycle "${cr.cycleName}" (#${cr.number})`);
    } else {
      const msg = `Failed to create cycle "${cr.cycleName}": ${cr.error}`;
      logger.info(`Linear sync warning: ${msg}`);
      result.errors.push(msg);
    }
  }

  // ── Step 6: Create issues (parallel with concurrency limit) ──
  const issueResults = await Promise.all(
    linearImport.issues.map((issue) =>
      sem.run(async () => {
        try {
          const issueLabelIds = issue.labels
            .map((l) => labelIdMap.get(l))
            .filter((id): id is string => Boolean(id));

          const cycleId = issue.cycleName ? cycleIdMap.get(issue.cycleName) : undefined;

          const payload = await client.createIssue({
            title: issue.title,
            description: issue.description,
            teamId,
            labelIds: issueLabelIds.length > 0 ? issueLabelIds : undefined,
            priority: linearPriority(issue.priority),
            ...(cycleId ? { cycleId } : {}),
          });

          const createdIssue = await payload.issue;
          if (createdIssue) {
            return { status: "created" as const, url: createdIssue.url };
          }
          return { status: "failed" as const, error: "No issue returned" };
        } catch (err) {
          return { status: "failed" as const, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    ),
  );
  for (let i = 0; i < issueResults.length; i++) {
    const ir = issueResults[i];
    if (ir.status === "created") {
      result.issueUrls.push(ir.url);
      result.created++;
    } else {
      const issueTitle = linearImport.issues[i]?.title ?? "unknown";
      const msg = `Failed to create issue "${issueTitle}": ${ir.error}`;
      logger.info(`Linear sync warning: ${msg}`);
      result.errors.push(msg);
      result.skipped++;
    }
  }

  logger.info(
    `Linear sync complete: ${result.created} created, ${result.skipped} skipped, ${result.errors.length} errors`,
  );

  return result;
}

/**
 * Map our priority strings to Linear's numeric priority.
 * Linear: 0=none, 1=urgent, 2=high, 3=medium, 4=low
 */
function linearPriority(priority: LinearIssueInput["priority"]): number {
  switch (priority) {
    case "urgent":
      return 1;
    case "high":
      return 2;
    case "medium":
      return 3;
    case "low":
      return 4;
    case "none":
    default:
      return 0;
  }
}

/**
 * Assign a deterministic color to a label based on its name.
 */
function labelColor(name: string): string {
  const colors = [
    "#6366f1", // indigo
    "#ec4899", // pink
    "#f59e0b", // amber
    "#10b981", // emerald
    "#3b82f6", // blue
    "#ef4444", // red
    "#8b5cf6", // violet
    "#06b6d4", // cyan
    "#84cc16", // lime
    "#f97316", // orange
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Build a project description from the Linear import metadata.
 */
function buildProjectDescription(linearImport: LinearImport, project: ProjectPlan): string {
  const lines: string[] = [
    linearImport.projectDescription,
    "",
    `**Generated by Agent Org** — ${linearImport.metadata.timestamp}`,
    `**Agents:** ${linearImport.metadata.agentCount} | **Tokens:** ~${(linearImport.metadata.tokenUsage.input + linearImport.metadata.tokenUsage.output).toLocaleString()} | **Duration:** ${(linearImport.metadata.durationMs / 1000).toFixed(1)}s`,
    "",
    `**Status:** ${project.status}`,
  ];

  if (project.gaps.length > 0) {
    lines.push("", "**Gaps:**", ...project.gaps.map((g) => `- ${g}`));
  }

  return lines.join("\n");
}
