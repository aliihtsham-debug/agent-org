// ── Phase 10 — Hash-Chained Append-Only Audit Log ──────────────────────
//
// Every agent action is recorded with a SHA-256 hash chain.
// Tamper-evident: modifying any entry breaks the chain.
//
// Storage: outputs/.audit/audit-chain.jsonl (append-only)
// Hash = SHA-256(JSON.stringify(entry) + previousHash)

import { appendFile, mkdir, readFile, access, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AuditEntry, AuditFilter, ChainVerificationResult } from "../types/audit-types.js";

function defaultAuditFile(): string {
  const dir = process.env.AGENT_ORG_AUDIT_DIR;
  return dir ? `${dir}/audit-chain.jsonl` : "outputs/.audit/audit-chain.jsonl";
}

async function ensureAuditDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

/**
 * Compute SHA-256 hash of the entry data concatenated with the previous hash.
 * Uses crypto.subtle.digest for cryptographic hashing.
 */
async function hashEntry(entry: Omit<AuditEntry, "entryHash">, previousHash: string): Promise<string> {
  const data = JSON.stringify({
    sequence: entry.sequence,
    timestamp: entry.timestamp,
    eventId: entry.eventId,
    agentDid: entry.agentDid,
    action: entry.action,
    inputHash: entry.inputHash,
    outputHash: entry.outputHash,
    inputRef: entry.inputRef,
    outputRef: entry.outputRef,
    signature: entry.signature,
    previousHash: entry.previousHash,
  });
  const payload = data + previousHash;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(payload));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getLastHash(filePath: string): Promise<string> {
  try {
    await access(filePath);
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return "genesis";
    const lastEntry = JSON.parse(lines[lines.length - 1]) as AuditEntry;
    return lastEntry.entryHash;
  } catch {
    return "genesis";
  }
}

async function getNextSequence(filePath: string): Promise<number> {
  try {
    await access(filePath);
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    return lines.length;
  } catch {
    return 0;
  }
}

export class AuditLog {
  private readonly _filePath: string;
  private _lastHash: string = "genesis";
  private _sequence: number = 0;
  private _initialized: boolean = false;

  constructor(filePath?: string) {
    this._filePath = filePath ?? defaultAuditFile();
  }

  private async ensureInit(): Promise<void> {
    if (this._initialized) return;
    await ensureAuditDir(this._filePath);
    this._lastHash = await getLastHash(this._filePath);
    this._sequence = await getNextSequence(this._filePath);
    this._initialized = true;
  }

  /**
   * Append a new entry to the audit chain.
   * Auto-assigns sequence number, previousHash, and computes SHA-256 entryHash.
   */
  async appendEntry(
    entry: Omit<AuditEntry, "sequence" | "entryHash" | "previousHash">,
  ): Promise<AuditEntry> {
    await this.ensureInit();

    const sequence = this._sequence;
    const previousHash = this._lastHash;

    const fullEntry: AuditEntry = {
      ...entry,
      sequence,
      previousHash,
      entryHash: "",
    };

    // Compute SHA-256 hash over the entry data + previousHash
    fullEntry.entryHash = await hashEntry(fullEntry, previousHash);

    // Append to file (append-only)
    await appendFile(this._filePath, JSON.stringify(fullEntry) + "\n");

    // Update state
    this._lastHash = fullEntry.entryHash;
    this._sequence = sequence + 1;

    return fullEntry;
  }

  /**
   * Verify the integrity of the entire audit chain.
   * Checks: sequence continuity, previousHash linkage, entryHash correctness.
   */
  async verifyChain(): Promise<ChainVerificationResult> {
    try {
      await access(this._filePath);
    } catch {
      return { valid: true, totalEntries: 0 };
    }

    const content = await readFile(this._filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    let previousHash = "genesis";

    for (let i = 0; i < lines.length; i++) {
      const entry = JSON.parse(lines[i]) as AuditEntry;

      // Check sequence continuity
      if (entry.sequence !== i) {
        return { valid: false, firstInvalid: i, totalEntries: lines.length };
      }

      // Check previous hash linkage
      if (entry.previousHash !== previousHash) {
        return { valid: false, firstInvalid: i, totalEntries: lines.length };
      }

      // Verify entry hash
      const { entryHash: _, ...withoutHash } = entry;
      const expectedHash = await hashEntry(withoutHash, previousHash);
      if (entry.entryHash !== expectedHash) {
        return { valid: false, firstInvalid: i, totalEntries: lines.length };
      }

      previousHash = entry.entryHash;
    }

    return { valid: true, totalEntries: lines.length };
  }

  /**
   * Retrieve audit entries, optionally filtered.
   */
  async getEntries(filter?: AuditFilter): Promise<AuditEntry[]> {
    try {
      await access(this._filePath);
    } catch {
      return [];
    }

    const content = await readFile(this._filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    let entries: AuditEntry[] = lines.map((l) => JSON.parse(l) as AuditEntry);

    if (filter) {
      if (filter.agentDid) {
        entries = entries.filter((e) => e.agentDid === filter.agentDid);
      }
      if (filter.action) {
        entries = entries.filter((e) => e.action === filter.action);
      }
      if (filter.fromSequence !== undefined) {
        entries = entries.filter((e) => e.sequence >= filter.fromSequence!);
      }
      if (filter.toSequence !== undefined) {
        entries = entries.filter((e) => e.sequence <= filter.toSequence!);
      }
      if (filter.fromTimestamp) {
        entries = entries.filter((e) => e.timestamp >= filter.fromTimestamp!);
      }
      if (filter.toTimestamp) {
        entries = entries.filter((e) => e.timestamp <= filter.toTimestamp!);
      }
    }

    return entries;
  }

  /**
   * Export all audit entries to a JSON file.
   */
  async exportToJSON(path: string): Promise<void> {
    const entries = await this.getEntries();
    const dir = dirname(path);
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify(entries, null, 2));
  }

  /**
   * Get the file path for this audit log.
   */
  getFilePath(): string {
    return this._filePath;
  }
}

export function createAuditLog(): AuditLog {
  return new AuditLog();
}
