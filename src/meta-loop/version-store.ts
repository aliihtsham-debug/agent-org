// ── Version Store ──────────────────────────────────────────────────────
// Persists proposals, applies them to source files, and supports rollback
// via before/after snapshots.

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { createHash } from "node:crypto";
import type { ProposedChange, ProposalStatus } from "../types/meta-types.js";

const PROPOSALS_DIR = "proposals";
const SNAPSHOTS_DIR = "snapshots";
const PENDING_FILE = "pending-proposals.json";

/**
 * Create a version store manager bound to an output base.
 */
export function createVersionStore(outputBase: string, projectRoot: string) {
  const proposalsBase = join(outputBase, ".meta", PROPOSALS_DIR);
  const snapshotsBase = join(outputBase, ".meta", SNAPSHOTS_DIR);
  const pendingPath = join(outputBase, ".meta", PENDING_FILE);

  // Ensure directories exist.
  async function ensureDirs(): Promise<void> {
    await mkdir(proposalsBase, { recursive: true });
    await mkdir(snapshotsBase, { recursive: true });
  }

  /**
   * Read the pending proposals list.
   */
  async function readPending(): Promise<ProposedChange[]> {
    try {
      const raw = await readFile(pendingPath, "utf-8");
      return JSON.parse(raw) as ProposedChange[];
    } catch {
      return [];
    }
  }

  /**
   * Write the pending proposals list.
   */
  async function writePending(proposals: ProposedChange[]): Promise<void> {
    await ensureDirs();
    await writeFile(pendingPath, JSON.stringify(proposals, null, 2), "utf-8");
  }

  /**
   * Save a proposal to disk (in its own file for audit trail) and
   * append it to the pending list.
   */
  async function writeProposal(proposal: ProposedChange): Promise<void> {
    await ensureDirs();
    // Write audit file.
    const dateDir = new Date().toISOString().slice(0, 10);
    const dir = join(proposalsBase, dateDir);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${proposal.proposalId}.json`);
    await writeFile(filePath, JSON.stringify(proposal, null, 2), "utf-8");

    // Append to pending list (if not already present).
    const pending = await readPending();
    if (!pending.some((p) => p.proposalId === proposal.proposalId)) {
      pending.push(proposal);
      await writePending(pending);
    }
  }

  /**
   * Save a before/after snapshot of a file for rollback.
   * Snapshots are stored at `${snapshotsBase}/${sourceFile}.before.${proposalId}.ts`
   * (flat file, not nested under sourceFile dir).
   */
  async function saveSnapshot(
    proposalId: string,
    sourceFile: string,
    beforeContent: string,
    afterContent: string,
  ): Promise<void> {
    // Sanitize sourceFile to a flat filename (replace path separators).
    const flatName = sourceFile.replace(/[\\/]/g, "__");
    await mkdir(snapshotsBase, { recursive: true });
    await writeFile(join(snapshotsBase, `${flatName}.before.${proposalId}.ts`), beforeContent, "utf-8");
    await writeFile(join(snapshotsBase, `${flatName}.after.${proposalId}.ts`), afterContent, "utf-8");
  }

  /**
   * Load a before-snapshot for rollback.
   */
  async function loadSnapshotBefore(proposalId: string, sourceFile: string): Promise<string | null> {
    try {
      const flatName = sourceFile.replace(/[\\/]/g, "__");
      const path = join(snapshotsBase, `${flatName}.before.${proposalId}.ts`);
      await access(path);
      return await readFile(path, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * Load an after-snapshot (for inspection).
   */
  async function loadSnapshotAfter(proposalId: string, sourceFile: string): Promise<string | null> {
    try {
      const flatName = sourceFile.replace(/[\\/]/g, "__");
      const path = join(snapshotsBase, `${flatName}.after.${proposalId}.ts`);
      await access(path);
      return await readFile(path, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * Apply a proposal to a source file on disk.
   * - Reads the current file content.
   * - Saves a before-snapshot.
   * - Applies the patch (simple text replacement for now).
   * - Saves an after-snapshot.
   * - Returns the new file content.
   *
   * NOTE: This is a simplified patch application. For production use,
   * replace with a proper unified-diff library.
   */
  async function applyProposal(
    proposal: ProposedChange,
    projectRoot: string,
  ): Promise<{ success: boolean; newContent?: string; error?: string }> {
    const filePath = join(projectRoot, proposal.sourceFile);

    try {
      const currentContent = await readFile(filePath, "utf-8");

      // Verify the current content matches the expected before-hash.
      const currentHash = createHash("sha256").update(currentContent).digest("hex");
      if (currentHash !== proposal.beforeHash) {
        return {
          success: false,
          error: `Hash mismatch: expected ${proposal.beforeHash.slice(0, 12)}, got ${currentHash.slice(0, 12)}. File was modified since proposal.`,
        };
      }

      // Save before-snapshot.
      await saveSnapshot(proposal.proposalId, proposal.sourceFile, currentContent, currentContent);

      // Apply the patch. For now, we use a simple approach:
      // The patch field contains the full new content (for simple replacements).
      // For unified-diff format, a proper parser would be needed.
      const newContent = applyPatch(currentContent, proposal.patch);

      // Write the new content.
      await writeFile(filePath, newContent, "utf-8");

      // Save after-snapshot.
      await saveSnapshot(proposal.proposalId, proposal.sourceFile, currentContent, newContent);

      return { success: true, newContent };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Roll back a proposal by restoring the before-snapshot.
   */
  async function rollbackProposal(
    proposalId: string,
    sourceFile: string,
    projectRoot: string,
  ): Promise<{ success: boolean; error?: string }> {
    const beforeContent = await loadSnapshotBefore(proposalId, sourceFile);
    if (beforeContent === null) {
      return { success: false, error: `No before-snapshot found for ${proposalId} on ${sourceFile}` };
    }

    const filePath = join(projectRoot, sourceFile);
    try {
      await writeFile(filePath, beforeContent, "utf-8");
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * List all applied proposals (those with status "applied").
   */
  async function listApplied(): Promise<ProposedChange[]> {
    const pending = await readPending();
    return pending.filter((p) => p.status === "applied");
  }

  /**
   * List all pending proposals.
   */
  async function listPending(): Promise<ProposedChange[]> {
    return readPending();
  }

  /**
   * Update a proposal's status in the pending list.
   */
  async function updateStatus(proposalId: string, status: ProposalStatus, metadata: { appliedAt?: string; rolledBackAt?: string; rejectionReason?: string } = {}): Promise<void> {
    const pending = await readPending();
    const proposal = pending.find((p) => p.proposalId === proposalId);
    if (proposal) {
      proposal.status = status;
      if (metadata.appliedAt) proposal.appliedAt = metadata.appliedAt;
      if (metadata.rolledBackAt) proposal.rolledBackAt = metadata.rolledBackAt;
      if (metadata.rejectionReason) proposal.rejectionReason = metadata.rejectionReason;
      await writePending(pending);
    }
  }

  return {
    writeProposal,
    saveSnapshot,
    loadSnapshotBefore,
    loadSnapshotAfter,
    applyProposal,
    rollbackProposal,
    listApplied,
    listPending,
    readPending,
    writePending,
    updateStatus,
    ensureDirs,
  };
}

export type VersionStore = ReturnType<typeof createVersionStore>;

/**
 * Simple patch application.
 *
 * Supports two formats:
 * 1. "replace": { oldText: string, newText: string } — simple find/replace.
 * 2. "unified-diff" — basic unified diff parsing (lines starting with +/-).
 *
 * For more complex patches, integrate a library like `diff` or `patch`.
 */
function applyPatch(currentContent: string, patch: string): string {
  // Try JSON-encoded replace instruction first.
  try {
    const parsed = JSON.parse(patch) as { oldText?: string; newText?: string };
    if (parsed.oldText !== undefined && parsed.newText !== undefined) {
      if (!currentContent.includes(parsed.oldText)) {
        throw new Error("oldText not found in current content");
      }
      return currentContent.replace(parsed.oldText, parsed.newText);
    }
  } catch {
    // Not JSON — fall through to unified-diff parsing.
  }

  // Basic unified-diff application (simplified).
  // Expects a patch in the format:
  //   --- a/file
  //   +++ b/file
  //   @@ -start,count +start,count @@
  //   context
  //   -removed
  //   +added
  //   context
  //
  // For safety, we only apply patches that have exactly one hunk.
  const lines = patch.split("\n");
  const hunks: { oldLines: string[]; newLines: string[] }[] = [];
  let currentHunk: { oldLines: string[]; newLines: string[] } | null = null;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = { oldLines: [], newLines: [] };
    } else if (currentHunk) {
      if (line.startsWith("-") && !line.startsWith("---")) {
        currentHunk.oldLines.push(line.slice(1));
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        currentHunk.newLines.push(line.slice(1));
      } else {
        // Context line — must match both sides.
        currentHunk.oldLines.push(line.slice(1));
        currentHunk.newLines.push(line.slice(1));
      }
    }
  }
  if (currentHunk) hunks.push(currentHunk);

  if (hunks.length === 0) {
    throw new Error("No hunks found in patch");
  }

  let result = currentContent;
  for (const hunk of hunks) {
    const oldText = hunk.oldLines.join("\n");
    const newText = hunk.newLines.join("\n");
    if (!result.includes(oldText)) {
      throw new Error(`Hunk old text not found in content:\n${oldText.slice(0, 100)}...`);
    }
    result = result.replace(oldText, newText);
  }

  return result;
}
