import type {
  AgentRole,
  AgentResult,
  CritiqueResult,
  RefinementConfig,
  RefinementResult,
} from "../types/agent-types.js";
import type { AgentContext } from "../agents/base-agent.js";
import { runAgentWithRetry } from "../agents/base-agent.js";
import { writeOutput, ensureDir } from "../tools/file-tools.js";
import { parseCritique, extractJsonBlock } from "./critique-parser.js";
import { getReviewSystemPrompt, getReviewUserMessage, getRefinementSystemPrompt, getRefinementUserMessage } from "../prompts/refinement-prompts.js";
import type { AgentResultsRegistry } from "../communication/results-registry.js";
import { DEFAULT_REVIEW_PAIRS } from "./review-pairs.js";

/**
 * Severity ranking for filtering. Higher number = more severe.
 */
const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

/**
 * Run the full refinement phase:
 * 1. Parallel review — spawn reviewers for all pairs
 * 2. Filter critiques by severity threshold
 * 3. Parallel refinement — re-spawn agents with actionable critiques
 * 4. Write refinement artifacts to disk
 * 5. Return refinement report
 */
export async function runRefinementPhase(
  idea: string,
  ctx: AgentContext,
  registry: AgentResultsRegistry,
  config: RefinementConfig,
): Promise<{
  critiques: CritiqueResult[];
  refinements: Map<AgentRole, RefinementResult>;
  totalReviews: number;
  actionableCritiques: number;
  refinedAgents: string[];
}> {
  const reviewPairs = config.reviewPairs.length > 0 ? config.reviewPairs : DEFAULT_REVIEW_PAIRS;
  const minRank = SEVERITY_RANK[config.minSeverity] ?? SEVERITY_RANK["high"];

  ctx.logger.info(`Refinement: starting ${reviewPairs.length} cross-functional reviews…`);

  // ── Step 1: Parallel review ──
  const reviewResults = await Promise.all(
    reviewPairs.map((pair) => runSingleReview(idea, ctx, registry, pair)),
  );

  const critiques = reviewResults.filter((c): c is CritiqueResult => c !== null);
  ctx.logger.info(`Refinement: ${critiques.length}/${reviewPairs.length} reviews completed`);

  // Write critiques to disk
  await writeCritiquesToDisk(critiques, ctx.outputBase);

  // ── Step 2: Filter by severity ──
  const actionable = critiques.filter((c) => (SEVERITY_RANK[c.severity] ?? 0) >= minRank);
  ctx.logger.info(`Refinement: ${actionable.length} actionable critiques (severity >= ${config.minSeverity})`);

  // Group critiques by reviewee
  const critiquesByReviewee = new Map<AgentRole, CritiqueResult[]>();
  for (const c of actionable) {
    const existing = critiquesByReviewee.get(c.reviewee) ?? [];
    existing.push(c);
    critiquesByReviewee.set(c.reviewee, existing);
  }

  // ── Step 3: Parallel refinement ──
  const refinements = new Map<AgentRole, RefinementResult>();
  const refineEntries = [...critiquesByReviewee.entries()];

  if (refineEntries.length > 0) {
    ctx.logger.info(`Refinement: re-spawning ${refineEntries.length} agents for refinement…`);

    const refinementResults = await Promise.all(
      refineEntries.map(([role, roleCritiques]) =>
        runSingleRefinement(idea, ctx, registry, role, roleCritiques, config.maxIterations),
      ),
    );

    for (const result of refinementResults) {
      if (result) {
        refinements.set(result.refinedResult.role, result);
        registry.publish(result.refinedResult);
      }
    }
  }

  ctx.logger.info(`Refinement: ${refinements.size} agents refined`);

  return {
    critiques,
    refinements,
    totalReviews: reviewPairs.length,
    actionableCritiques: actionable.length,
    refinedAgents: [...refinements.keys()],
  };
}

/**
 * Run a single cross-functional review.
 * Returns null if the reviewee has no result in the registry.
 */
async function runSingleReview(
  idea: string,
  ctx: AgentContext,
  registry: AgentResultsRegistry,
  pair: { reviewer: AgentRole; reviewee: AgentRole; reviewFocus: string; maxIterations: number },
): Promise<CritiqueResult | null> {
  const revieweeResult = registry.get(pair.reviewee);
  if (!revieweeResult || revieweeResult.status === "failed") {
    ctx.logger.info(`Refinement: skipping ${pair.reviewer}→${pair.reviewee} (no result)`);
    return null;
  }

  const revieweeSummary = registry.getSummary(pair.reviewee) ?? revieweeResult.summary;

  // Read the reviewee's full output from disk if available
  let revieweeOutput = revieweeSummary;
  try {
    const { readFileIfExists } = await import("../tools/file-tools.js");
    if (revieweeResult.artifacts.length > 0) {
      const content = await readFileIfExists(revieweeResult.artifacts[0]);
      if (content) revieweeOutput = content;
    }
  } catch {
    // Fall back to summary
  }

  const outputPath = `${ctx.outputBase}/refinement/reviews/${pair.reviewer}-${pair.reviewee}`;
  const reviewPair = {
    reviewer: pair.reviewer,
    reviewee: pair.reviewee,
    reviewFocus: pair.reviewFocus,
    maxIterations: pair.maxIterations,
  };

  const reviewSystemPrompt = getReviewSystemPrompt(reviewPair);
  const reviewUserMessage = getReviewUserMessage(reviewPair, revieweeOutput, idea);

  ctx.logger.info(`Refinement: ${pair.reviewer} reviewing ${pair.reviewee}…`);

  const reviewSpec = {
    id: `review-${pair.reviewer}-${pair.reviewee}-${Date.now()}`,
    role: pair.reviewer,
    task: reviewUserMessage,
    context: "",
    outputPath,
  };

  // Run the reviewer with a custom system prompt via the context
  // We override by passing the review instructions as the task
  const reviewCtx: AgentContext = {
    ...ctx,
    logger: ctx.logger,
  };

  const result = await runAgentWithRetry(reviewSpec, reviewCtx);

  if (result.status === "failed") {
    ctx.logger.info(`Refinement: ${pair.reviewer} review of ${pair.reviewee} failed`);
    return null;
  }

  // Read the review output
  let reviewText = result.summary;
  try {
    const { readFileIfExists } = await import("../tools/file-tools.js");
    const content = await readFileIfExists(`${outputPath}/output.md`);
    if (content) reviewText = content;
  } catch {
    // Fall back to summary
  }

  const critique = parseCritique(reviewText, pair.reviewer, pair.reviewee);

  // Emit review event
  ctx.logger.info(
    `Refinement: ${pair.reviewer}→${pair.reviewee} → severity=${critique.severity}, findings=${critique.findings.length}`,
  );

  return critique;
}

/**
 * Run a single refinement — re-spawn an agent with its critiques.
 */
async function runSingleRefinement(
  idea: string,
  ctx: AgentContext,
  registry: AgentResultsRegistry,
  role: AgentRole,
  critiques: CritiqueResult[],
  maxIterations: number,
): Promise<RefinementResult | null> {
  const originalResult = registry.get(role);
  if (!originalResult) return null;

  ctx.logger.info(`Refinement: ${role} incorporating ${critiques.length} critique(s)…`);

  // Read original full output from disk
  let originalOutput = originalResult.summary;
  try {
    const { readFileIfExists } = await import("../tools/file-tools.js");
    if (originalResult.artifacts.length > 0) {
      const content = await readFileIfExists(originalResult.artifacts[0]);
      if (content) originalOutput = content;
    }
  } catch {
    // Fall back to summary
  }

  const refinedOutputPath = `${originalResult.outputPath}/refined`;
  const refinementUserMessage = getRefinementUserMessage(role, originalOutput, critiques, idea);

  const refineSpec = {
    id: `refine-${role}-${Date.now()}`,
    role,
    task: refinementUserMessage,
    context: "",
    outputPath: refinedOutputPath,
  };

  const refineCtx: AgentContext = { ...ctx };
  const refinedResult = await runAgentWithRetry(refineSpec, refineCtx);

  if (refinedResult.status === "failed") {
    ctx.logger.info(`Refinement: ${role} refinement failed, keeping original`);
    return {
      originalResult,
      refinedResult: originalResult, // Keep original on failure
      critiques,
      iteration: 1,
    };
  }

  ctx.logger.info(`Refinement: ${role} refined successfully`);

  return {
    originalResult,
    refinedResult: {
      ...refinedResult,
      role, // Ensure role is set correctly
      outputPath: refinedOutputPath,
    },
    critiques,
    iteration: 1 <= maxIterations ? 1 : maxIterations,
  };
}

/**
 * Write structured critique files to disk for audit trail.
 */
async function writeCritiquesToDisk(
  critiques: CritiqueResult[],
  outputBase: string,
): Promise<void> {
  const reviewsDir = `${outputBase}/refinement/critiques`;
  await ensureDir(reviewsDir);

  for (const c of critiques) {
    const filename = `${c.reviewer}-${c.reviewee}.json`;
    await writeOutput(`${reviewsDir}/${filename}`, JSON.stringify(c, null, 2));
  }
}

/**
 * Write a human-readable refinement summary to disk.
 */
export async function writeRefinementSummary(
  outputBase: string,
  totalReviews: number,
  actionableCritiques: number,
  refinedAgents: string[],
  critiques: CritiqueResult[],
): Promise<void> {
  const summaryDir = `${outputBase}/refinement`;
  await ensureDir(summaryDir);

  const agentCritiqueMap = new Map<string, CritiqueResult[]>();
  for (const c of critiques) {
    const existing = agentCritiqueMap.get(c.reviewee) ?? [];
    existing.push(c);
    agentCritiqueMap.set(c.reviewee, existing);
  }

  let md = `# Refinement Report\n\n`;
  md += `**Total Reviews:** ${totalReviews}\n`;
  md += `**Actionable Critiques:** ${actionableCritiques}\n`;
  md += `**Agents Refined:** ${refinedAgents.length}\n\n`;

  md += `---\n\n## Critiques by Agent\n\n`;

  for (const [agent, agentCritiques] of agentCritiqueMap) {
    md += `### ${agent}\n\n`;
    for (const c of agentCritiques) {
      md += `**From:** ${c.reviewer} | **Severity:** ${c.severity}\n\n`;
      for (const finding of c.findings) {
        md += `- ${finding}\n`;
      }
      md += `\n`;
    }
  }

  if (refinedAgents.length > 0) {
    md += `---\n\n## Refined Agents\n\n`;
    for (const role of refinedAgents) {
      md += `- ${role}\n`;
    }
  }

  await writeOutput(`${summaryDir}/summary.md`, md);
}
