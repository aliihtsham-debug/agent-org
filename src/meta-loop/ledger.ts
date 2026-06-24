// ── Meta-Loop Ledger ────────────────────────────────────────────────────
// Hash-chained append-only audit log for meta-loop actions.
// Mirrors the pattern in src/audit/audit-log.ts but scoped to meta-loop
// operations (proposals applied, rolled back, rejected).

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

export interface LedgerEntry {
  /** Monotonic sequence number (1-based). */
  sequence: number;
  /** ISO timestamp. */
  timestamp: string;
  /** Type of action recorded. */
  action: "proposal_applied" | "proposal_rejected" | "proposal_rolled_back" | "config_updated" | "capture_recorded";
  /** Proposal ID, if applicable. */
  proposalId?: string;
  /** SHA-256 of the governed file after this action (if applicable). */
  resultingHash?: string;
  /** Human-readable summary. */
  summary: string;
  /** SHA-256 hash of the previous ledger entry (empty string for genesis). */
  previousHash: string;
  /** SHA-256 of this entry's content (computed at write time). */
  entryHash: string;
}

const LEDGER_FILE = "ledger.jsonl";
const GENESIS_HASH = "0".repeat(64);

/**
 * Create a ledger manager bound to an output base.
 * The ledger file lives at `${outputBase}/.meta/ledger.jsonl`.
 */
export function createLedger(outputBase: string) {
  const ledgerPath = join(outputBase, ".meta", LEDGER_FILE);

  // Ensure the .meta directory exists.
  const dir = dirname(ledgerPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  /**
   * Read all entries from the ledger. Returns [] if the ledger doesn't exist yet.
   */
  function readEntries(): LedgerEntry[] {
    try {
      if (!existsSync(ledgerPath)) return [];
      const content = readFileSync(ledgerPath, "utf-8").trim();
      if (!content) return [];
      return content.split("\n").map((line) => JSON.parse(line) as LedgerEntry);
    } catch {
      return [];
    }
  }

  /**
   * Get the hash of the last entry (or GENESIS_HASH if empty).
   */
  function lastHash(): string {
    const entries = readEntries();
    if (entries.length === 0) return GENESIS_HASH;
    return entries[entries.length - 1].entryHash;
  }

  /**
   * Compute the SHA-256 hash of an entry's content (for chaining).
   */
  function computeHash(entry: Omit<LedgerEntry, "entryHash">): string {
    const canonical = JSON.stringify({
      sequence: entry.sequence,
      timestamp: entry.timestamp,
      action: entry.action,
      proposalId: entry.proposalId,
      resultingHash: entry.resultingHash,
      summary: entry.summary,
      previousHash: entry.previousHash,
    });
    return createHash("sha256").update(canonical).digest("hex");
  }

  /**
   * Append a new entry to the ledger. Returns the written entry.
   */
  function append(
    action: LedgerEntry["action"],
    summary: string,
    options: { proposalId?: string; resultingHash?: string } = {},
  ): LedgerEntry {
    const entries = readEntries();
    const previousHash = lastHash();
    const sequence = entries.length + 1;
    const timestamp = new Date().toISOString();

    const partial: Omit<LedgerEntry, "entryHash"> = {
      sequence,
      timestamp,
      action,
      proposalId: options.proposalId,
      resultingHash: options.resultingHash,
      summary,
      previousHash,
    };

    const entryHash = computeHash(partial);
    const entry: LedgerEntry = { ...partial, entryHash };

    appendFileSync(ledgerPath, JSON.stringify(entry) + "\n", "utf-8");
    return entry;
  }

  /**
   * Verify the integrity of the entire chain.
   * Returns { valid: true } or { valid: false, firstInvalid }.
   */
  function verifyChain(): { valid: boolean; firstInvalid?: number } {
    const entries = readEntries();
    let expectedPrevious = GENESIS_HASH;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.previousHash !== expectedPrevious) {
        return { valid: false, firstInvalid: entry.sequence };
      }
      // Recompute hash to detect tampering.
      const { entryHash: entryHashValue, ...withoutHash } = entry;
      const recomputed = computeHash(withoutHash);
      if (recomputed !== entryHashValue) {
        return { valid: false, firstInvalid: entry.sequence };
      }
      expectedPrevious = entryHashValue;
    }

    return { valid: true };
  }

  /**
   * Get all entries (for status display).
   */
  function getAll(): LedgerEntry[] {
    return readEntries();
  }

  return { append, verifyChain, getAll, readEntries };
}

export type Ledger = ReturnType<typeof createLedger>;
