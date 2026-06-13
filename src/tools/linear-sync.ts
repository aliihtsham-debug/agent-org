import type { LinearClient } from "@linear/sdk";
import type { AgentLogger } from "../observability/logger.js";
import type { LinearImport, LinearSyncResult, LinearIssueInput } from "./linear-types.js";
import type { ProjectPlan } from "../types/agent-types.js";

export interface LinearSyncOptions {
  apiKey: string;
  linearImport: LinearImport;
  project: ProjectPlan;
  logger: AgentLogger;
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
  const { apiKey, linearImport, project, logger } = options;

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

  // ── Step 2: Create labels ──
  const labelIdMap = new Map<string, string>();
  for (const labelName of linearImport.labels) {
    try {
      const payload = await client.createIssueLabel({
        name: labelName,
        teamId,
        color: labelColor(labelName),
      });
      const label = await payload.issueLabel;
      if (label) {
        labelIdMap.set(labelName, label.id);
        result.labelIds.push(label.id);
        result.created++;
      }
    } catch (err) {
      // Label may already exist — try to find it
      try {
        const existing = await client.issueLabels({ filter: { name: { eq: labelName } } });
        const found = existing.nodes[0];
        if (found) {
          labelIdMap.set(labelName, found.id);
          result.labelIds.push(found.id);
          result.skipped++;
        } else {
          throw new Error("not found");
        }
      } catch {
        const msg = `Failed to create label "${labelName}": ${err instanceof Error ? err.message : String(err)}`;
        logger.info(`Linear sync warning: ${msg}`);
        result.errors.push(msg);
      }
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

  // ── Step 5: Create cycles ──
  const cycleIdMap = new Map<string, string>();
  for (const cycle of linearImport.cycles) {
    try {
      const payload = await client.createCycle({
        name: cycle.name,
        teamId,
        startsAt: new Date(cycle.startsAt),
        endsAt: new Date(cycle.endsAt),
      });
      const createdCycle = await payload.cycle;
      if (createdCycle) {
        cycleIdMap.set(cycle.name, createdCycle.id);
        result.cycleUrls.push(`https://linear.app/cycle/${createdCycle.number}`);
        result.created++;
        logger.info(`Linear sync: created cycle "${cycle.name}" (#${createdCycle.number})`);
      }
    } catch (err) {
      const msg = `Failed to create cycle "${cycle.name}": ${err instanceof Error ? err.message : String(err)}`;
      logger.info(`Linear sync warning: ${msg}`);
      result.errors.push(msg);
    }
  }

  // ── Step 6: Create issues ──
  for (const issue of linearImport.issues) {
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
        result.issueUrls.push(createdIssue.url);
        result.created++;
      }
    } catch (err) {
      const msg = `Failed to create issue "${issue.title}": ${err instanceof Error ? err.message : String(err)}`;
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
