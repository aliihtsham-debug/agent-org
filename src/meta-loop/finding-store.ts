// ── Finding Store ──────────────────────────────────────────────────────
// Stable findingId generation + acceptance tracking.
// Each finding is hashed from (reviewer + reviewee + findingText) so that
// the same critique across runs gets the same ID — enabling cross-run
// aggregation and acceptance-rate tracking.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { AgentRole } from "../types/agent-types.js";

/** A finding record in the store. */
export interface FindingRecord {
  /** Stable ID: SHA-256(reviewer + reviewee + findingText).slice(0,16). */
  findingId: string;
  reviewer: AgentRole;
  reviewee: AgentRole;
  findingText: string;
  /** First run this finding was observed. */
  firstSeenRunId: string;
  firstSeenAt: string;
  /** Last run this finding was observed. */
  lastSeenRunId: string;
  lastSeenAt: string;
  /** Number of times observed. */
  occurrenceCount: number;
  /** Number of times marked as addressed in refinement. */
  addressedCount: number;
  /** Whether this finding is still open (not yet addressed). */
  status: "open" | "addressed" | "wont-fix";
}

const FINDINGS_FILE = "findings.jsonl";

/**
 * Generate a stable findingId from (reviewer, reviewee, findingText).
 * The same triple always produces the same ID — enabling cross-run dedup.
 */
export function generateFindingId(reviewer: AgentRole, reviewee: AgentRole, findingText: string): string {
  const canonical = `${reviewer}|${reviewee}|${findingText.trim().toLowerCase()}`;
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/**
 * Create a finding store manager bound to an output base.
 * The store file lives at `${outputBase}/.meta/findings.jsonl`.
 */
export function createFindingStore(outputBase: string) {
  const storePath = join(outputBase, ".meta", FINDINGS_FILE);

  // Ensure the .meta directory exists.
  const dir = dirname(storePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  /**
   * Read all finding records from the store.
   */
  function readAll(): FindingRecord[] {
    try {
      if (!existsSync(storePath)) return [];
      const content = readFileSync(storePath, "utf-8").trim();
      if (!content) return [];
      return content.split("\n").map((line) => JSON.parse(line) as FindingRecord);
    } catch {
      return [];
    }
  }

  /**
   * Write all finding records back to the store (overwrite).
   */
  function writeAll(records: FindingRecord[]): void {
    const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    writeFileSync(storePath, content, "utf-8");
  }

  /**
   * Record a batch of findings from a single run.
   * - Generates stable findingIds.
   * - Updates occurrence counts for previously-seen findings.
   * - Adds new records for first-time findings.
   */
  function recordFindings(
    runId: string,
    reviewer: AgentRole,
    reviewee: AgentRole,
    findings: string[],
  ): string[] {
    const records = readAll();
    const index = new Map(records.map((r) => [r.findingId, r]));
    const timestamp = new Date().toISOString();
    const newIds: string[] = [];

    for (const findingText of findings) {
      const findingId = generateFindingId(reviewer, reviewee, findingText);
      newIds.push(findingId);

      const existing = index.get(findingId);
      if (existing) {
        existing.lastSeenRunId = runId;
        existing.lastSeenAt = timestamp;
        existing.occurrenceCount++;
      } else {
        const record: FindingRecord = {
          findingId,
          reviewer,
          reviewee,
          findingText,
          firstSeenRunId: runId,
          firstSeenAt: timestamp,
          lastSeenRunId: runId,
          lastSeenAt: timestamp,
          occurrenceCount: 1,
          addressedCount: 0,
          status: "open",
        };
        records.push(record);
        index.set(findingId, record);
      }
    }

    writeAll(records);
    return newIds;
  }

  /**
   * Mark a finding as addressed in a specific run.
   */
  function markAddressed(findingId: string, runId: string): void {
    const records = readAll();
    const record = records.find((r) => r.findingId === findingId);
    if (record) {
      record.addressedCount++;
      record.status = "addressed";
      record.lastSeenRunId = runId;
      record.lastSeenAt = new Date().toISOString();
      writeAll(records);
    }
  }

  /**
   * Mark a finding as wont-fix.
   */
  function markWontFix(findingId: string): void {
    const records = readAll();
    const record = records.find((r) => r.findingId === findingId);
    if (record) {
      record.status = "wont-fix";
      writeAll(records);
    }
  }

  /**
   * Compute the fix acceptance rate across all findings.
   * fixAcceptanceRate = addressedCount / max(occurrenceCount, 1) averaged.
   */
  function getFixAcceptanceRate(): number {
    const records = readAll();
    if (records.length === 0) return 0;
    let totalOccurrences = 0;
    let totalAddressed = 0;
    for (const r of records) {
      totalOccurrences += r.occurrenceCount;
      totalAddressed += r.addressedCount;
    }
    return totalOccurrences > 0 ? totalAddressed / totalOccurrences : 0;
  }

  /**
   * Get findings that have been seen at least `minOccurrences` times.
   */
  function getRecurringFindings(minOccurrences = 2): FindingRecord[] {
    return readAll().filter((r) => r.occurrenceCount >= minOccurrences);
  }

  /**
   * Get all open findings for a specific reviewee.
   */
  function getOpenFindingsForRole(reviewee: AgentRole): FindingRecord[] {
    return readAll().filter((r) => r.reviewee === reviewee && r.status === "open");
  }

  return {
    recordFindings,
    markAddressed,
    markWontFix,
    getFixAcceptanceRate,
    getRecurringFindings,
    getOpenFindingsForRole,
    readAll,
  };
}

export type FindingStore = ReturnType<typeof createFindingStore>;
