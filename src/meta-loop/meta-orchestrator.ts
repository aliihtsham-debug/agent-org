// ── Meta-Orchestrator ──────────────────────────────────────────────────
// The central controller for the self-evolving meta-loop.
// Orchestrates the 8-step flow: collect → aggregate → propose → gate → apply.

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { ProposedChange, RunSummary, MetaLoopConfig } from "../types/meta-types.js";
import type { AgentResult, AgentRole, ProjectPlan } from "../types/agent-types.js";
import type { CritiqueResult } from "../types/agent-types.js";
import { loadMetaConfig, saveMetaConfig } from "./meta-config.js";
import { createLedger } from "./ledger.js";
import { collectRunSignals, readCritiques } from "./run-collector.js";
import { readLastNRuns, aggregateRuns } from "./aggregator.js";
import { createFindingStore } from "./finding-store.js";
import { createVersionStore } from "./version-store.js";
import { evaluateAllRules } from "./proposer-rules.js";
import { applyPromptEdit } from "./prompt-editor.js";
import { applyGovernanceEdit } from "./governance-editor.js";
import { applyCEOConfigEdit } from "./ceo-config-editor.js";

const RUNS_FILE = "runs.jsonl";
const META_DIR = ".meta";

export interface MetaOrchestratorOptions {
  outputBase: string;
  projectRoot: string;
  runId: string;
  idea: string;
  status: "complete" | "partial" | "failed";
  vpResults: AgentResult[];
  icResults: AgentResult[];
  governanceDenials?: number;
  appliedProposalIds?: string[];
  promptVersion?: string;
  governanceVersion?: string;
}

/**
 * Run the full meta-orchestrator flow.
 *
 * @returns The list of proposals (pending, applied, or rejected).
 */
export async function evaluateAndApply(
  options: MetaOrchestratorOptions,
  mode: MetaLoopConfig["mode"],
): Promise<ProposedChange[]> {
  const { outputBase, projectRoot, runId, idea, status, vpResults, icResults } = options;
  const governanceDenials = options.governanceDenials ?? 0;
  const appliedProposalIds = options.appliedProposalIds ?? [];
  const promptVersion = options.promptVersion ?? "unknown";
  const governanceVersion = options.governanceVersion ?? "unknown";

  // ── Step 0: Load config ──
  const config = await loadMetaConfig(outputBase);
  if (!config.enabled && mode === "advisory") {
    return []; // Meta-loop disabled — no-op.
  }

  // ── Step 1: Collect signals ──
  const critiques = await readCritiques(outputBase);
  const summary = await collectRunSignals(
    outputBase,
    runId,
    idea,
    status,
    vpResults,
    icResults,
    critiques,
    governanceDenials,
    appliedProposalIds,
    promptVersion,
    governanceVersion,
  );

  // ── Step 2: Write to runs.jsonl ──
  await writeRunSummary(outputBase, summary);

  // ── Step 3: Record findings + acceptance tracking ──
  const findingStore = createFindingStore(outputBase);
  for (const critique of critiques) {
    const findingIds = findingStore.recordFindings(runId, critique.reviewer, critique.reviewee, critique.findings);
    // Acceptance tracking: scan refinement output for findingId references.
    // (Simplified — full implementation in Phase C.)
  }

  // ── Short-circuit for capture-only mode ──
  if (mode === "capture") {
    return [];
  }

  // ── Step 4: Aggregate sliding window ──
  const runs = await readLastNRuns(outputBase, config.windowSize);
  const window = aggregateRuns(runs);

  // ── Step 5: Evaluate proposer rules ──
  const currentHashes = await computeFileHashes(projectRoot);
  const proposals = evaluateAllRules(window, { runId, currentFileHashes: currentHashes }, mode);

  // ── Short-circuit for propose-only mode ──
  if (mode === "propose" || mode === "advisory") {
    const versionStore = createVersionStore(outputBase, projectRoot);
    for (const proposal of proposals) {
      await versionStore.writeProposal(proposal);
    }
    // Update pending-proposals.json.
    const pending = await versionStore.readPending();
    await versionStore.writePending([...pending, ...proposals]);
    return proposals;
  }

  // ── Step 6: Apply proposals (with gate) ──
  const versionStore = createVersionStore(outputBase, projectRoot);
  const ledger = createLedger(outputBase);
  const applied: ProposedChange[] = [];

  for (const proposal of proposals) {
    // Confidence gate.
    if (proposal.confidence < config.minConfidence) {
      await versionStore.updateStatus(proposal.proposalId, "rejected", {
        rejectionReason: `Confidence ${proposal.confidence.toFixed(2)} below threshold ${config.minConfidence}`,
      });
      ledger.append("proposal_rejected", `Rejected ${proposal.proposalId} (confidence too low)`, { proposalId: proposal.proposalId });
      continue;
    }

    // Apply the proposal using the appropriate editor.
    const result = await applyProposalByCategory(proposal, projectRoot, versionStore);
    if (!result.success) {
      await versionStore.updateStatus(proposal.proposalId, "rejected", {
        rejectionReason: result.error ?? "Apply failed",
      });
      ledger.append("proposal_rejected", `Rejected ${proposal.proposalId}: ${result.error}`, { proposalId: proposal.proposalId });
      continue;
    }

    // Success — update status.
    const appliedAt = new Date().toISOString();
    const afterHash = createHash("sha256").update(result.newContent ?? "").digest("hex");
    const updatedProposal: ProposedChange = {
      ...proposal,
      status: "applied",
      appliedAt,
      afterHash,
    };

    await versionStore.updateStatus(proposal.proposalId, "applied", { appliedAt });
    await versionStore.writeProposal(updatedProposal);
    ledger.append("proposal_applied", `Applied ${proposal.proposalId} to ${proposal.sourceFile}`, {
      proposalId: proposal.proposalId,
      resultingHash: afterHash,
    });

    applied.push(updatedProposal);
  }

  return applied;
}

/**
 * Write a RunSummary line to runs.jsonl.
 */
async function writeRunSummary(outputBase: string, summary: RunSummary): Promise<void> {
  const metaDir = join(outputBase, META_DIR);
  if (!existsSync(metaDir)) mkdirSync(metaDir, { recursive: true });
  const runsPath = join(metaDir, RUNS_FILE);
  appendFileSync(runsPath, JSON.stringify(summary) + "\n", "utf-8");
}

/**
 * Compute SHA-256 hashes of governed source files.
 */
async function computeFileHashes(projectRoot: string): Promise<Record<string, string>> {
  const files = [
    "src/prompts/agent-prompts.ts",
    "src/governance/policy-templates.ts",
    "src/orchestrator/ceo-agent.ts",
    "src/refinement/review-pairs.ts",
  ];
  const hashes: Record<string, string> = {};

  const { readFile } = await import("node:fs/promises");
  for (const file of files) {
    try {
      const content = await readFile(join(projectRoot, file), "utf-8");
      hashes[file] = createHash("sha256").update(content).digest("hex");
    } catch {
      hashes[file] = "unknown";
    }
  }

  return hashes;
}

/**
 * Apply a proposal using the appropriate editor based on its category.
 */
async function applyProposalByCategory(
  proposal: ProposedChange,
  projectRoot: string,
  versionStore: ReturnType<typeof createVersionStore>,
): Promise<{ success: boolean; newContent?: string; error?: string }> {
  switch (proposal.category) {
    case "prompt": {
      const result = await applyPromptEdit(proposal, projectRoot);
      if (!result.success) return result;
      // Save snapshot for rollback (reuse version-store's snapshot mechanism).
      // The version-store applyProposal handles snapshots for simple patches;
      // for editor-based patches we save a manual snapshot here.
      const currentContent = result.newContent ?? "";
      await versionStore.saveSnapshot(proposal.proposalId, proposal.sourceFile, currentContent, currentContent);
      return result;
    }
    case "governance": {
      return applyGovernanceEdit(proposal, projectRoot);
    }
    case "ceo-config": {
      return applyCEOConfigEdit(proposal, projectRoot);
    }
    default:
      return { success: false, error: `Unknown proposal category: ${proposal.category}` };
  }
}

/**
 * Roll back a specific proposal by ID.
 */
export async function rollbackProposal(
  outputBase: string,
  projectRoot: string,
  proposalId: string,
): Promise<{ success: boolean; error?: string }> {
  const versionStore = createVersionStore(outputBase, projectRoot);
  const ledger = createLedger(outputBase);

  // Find the proposal in the pending list.
  const pending = await versionStore.readPending();
  const proposal = pending.find((p) => p.proposalId === proposalId);
  if (!proposal) {
    return { success: false, error: `Proposal ${proposalId} not found` };
  }

  const result = await versionStore.rollbackProposal(proposalId, proposal.sourceFile, projectRoot);
  if (!result.success) {
    return result;
  }

  await versionStore.updateStatus(proposalId, "rolled-back", { rolledBackAt: new Date().toISOString() });
  ledger.append("proposal_rolled_back", `Rolled back ${proposalId} on ${proposal.sourceFile}`, { proposalId });

  return { success: true };
}

/**
 * Get meta-loop status (pending + applied proposals, last runs).
 */
export async function getMetaStatus(outputBase: string, projectRoot: string) {
  const versionStore = createVersionStore(outputBase, projectRoot);
  const ledger = createLedger(outputBase);
  const pending = await versionStore.readPending();
  const applied = pending.filter((p) => p.status === "applied");
  const pendingOnly = pending.filter((p) => p.status === "pending");
  const runs = await readLastNRuns(outputBase, 5);

  return {
    pendingProposals: pendingOnly,
    appliedProposals: applied,
    lastRuns: runs,
    ledgerValid: ledger.verifyChain(),
  };
}
