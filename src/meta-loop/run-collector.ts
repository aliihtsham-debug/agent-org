// ── Run Collector ───────────────────────────────────────────────────────
// Reads all signal sources from a completed run and produces a RunSummary
// for the meta-loop's runs.jsonl.

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { RunSummary, RoleMetric } from "../types/meta-types.js";
import type { AgentResult, AgentRole, ProjectPlan } from "../types/agent-types.js";
import type { CritiqueResult } from "../types/agent-types.js";
import type { AgentEvent } from "../observability/events.js";
import type { ArtifactEntry } from "../observability/structured-log.js";

/**
 * Collect a RunSummary for a completed run.
 *
 * @param outputBase  Absolute path to the run's outputs directory.
 * @param runId       The run ID (for correlation).
 * @param idea        The original idea (for hashing).
 * @param status      Overall run status.
 * @param vpResults   Results from the 5 VPs.
 * @param icResults   Results from all IC agents.
 * @param refinementCritiques  Critiques produced by the refinement phase (if any).
 * @param governanceDenials   Number of policy denials during this run.
 * @param appliedProposalIds  IDs of proposals consumed this run.
 * @param promptVersion       SHA-256 of the prompts file at run time.
 * @param governanceVersion   SHA-256 of the policy templates at run time.
 */
export async function collectRunSignals(
  outputBase: string,
  runId: string,
  idea: string,
  status: "complete" | "partial" | "failed",
  vpResults: AgentResult[],
  icResults: AgentResult[],
  refinementCritiques: CritiqueResult[] = [],
  governanceDenials = 0,
  appliedProposalIds: string[] = [],
  promptVersion = "unknown",
  governanceVersion = "unknown",
): Promise<RunSummary> {
  const allResults = [...vpResults, ...icResults];

  // Compute aggregate token usage.
  const totalInput = allResults.reduce((sum, r) => sum + r.tokenUsage.input, 0);
  const totalOutput = allResults.reduce((sum, r) => sum + r.tokenUsage.output, 0);

  // Compute total duration = max of individual durations (parallel execution).
  const totalDurationMs = allResults.reduce((max, r) => Math.max(max, r.durationMs), 0);

  // Critique breakdown.
  const critiqueBreakdown = { critical: 0, high: 0, medium: 0, low: 0, none: 0 };
  for (const c of refinementCritiques) {
    critiqueBreakdown[c.severity]++;
  }
  const actionableCritiques = critiqueBreakdown.critical + critiqueBreakdown.high;

  // Build per-role metrics.
  const roleMetrics = await buildRoleMetrics(allResults, outputBase);

  return {
    runId,
    timestamp: new Date().toISOString(),
    ideaHash: createHash("sha256").update(idea).digest("hex").slice(0, 16),
    status,
    totalAgents: allResults.length,
    totalTokens: { input: totalInput, output: totalOutput },
    totalDurationMs,
    actionableCritiques,
    critiqueBreakdown,
    governanceDenials,
    appliedProposalIds,
    promptVersion,
    governanceVersion,
    roleMetrics,
  };
}

/**
 * Build per-role metrics, including artifact sizes where available.
 */
async function buildRoleMetrics(
  results: AgentResult[],
  outputBase: string,
): Promise<Record<AgentRole, RoleMetric>> {
  const metrics = {} as Record<AgentRole, RoleMetric>;

  for (const result of results) {
    // Compute total artifact size for this role.
    let artifactSize = 0;
    for (const artifactPath of result.artifacts) {
      try {
        const fullPath = join(outputBase, artifactPath);
        const s = await stat(fullPath);
        artifactSize += s.size;
      } catch {
        // File may not exist — skip.
      }
    }

    metrics[result.role] = {
      status: result.status,
      tokenUsage: result.tokenUsage,
      durationMs: result.durationMs,
      reputationScore: result.reputationScore,
    };
  }

  return metrics;
}

/**
 * Read the project-plan.json from disk (for re-collection scenarios).
 */
export async function readProjectPlan(outputBase: string): Promise<ProjectPlan | null> {
  try {
    const raw = await readFile(join(outputBase, "project-plan.json"), "utf-8");
    return JSON.parse(raw) as ProjectPlan;
  } catch {
    return null;
  }
}

/**
 * Read agent-events.jsonl from disk.
 */
export async function readAgentEvents(outputBase: string): Promise<AgentEvent[]> {
  try {
    const raw = await readFile(join(outputBase, "agent-events.jsonl"), "utf-8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AgentEvent);
  } catch {
    return [];
  }
}

/**
 * Read artifact-manifest.json from disk.
 */
export async function readArtifactManifest(outputBase: string): Promise<{ artifacts: ArtifactEntry[] } | null> {
  try {
    const raw = await readFile(join(outputBase, "artifact-manifest.json"), "utf-8");
    return JSON.parse(raw) as { artifacts: ArtifactEntry[] };
  } catch {
    return null;
  }
}

/**
 * Read critiques from a refinement output directory.
 */
export async function readCritiques(outputBase: string): Promise<CritiqueResult[]> {
  try {
    const { readdir } = await import("node:fs/promises");
    const critiquesDir = join(outputBase, "refinement", "critiques");
    const files = await readdir(critiquesDir);
    const critiques: CritiqueResult[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const raw = await readFile(join(critiquesDir, file), "utf-8");
      critiques.push(JSON.parse(raw) as CritiqueResult);
    }
    return critiques;
  } catch {
    return [];
  }
}
