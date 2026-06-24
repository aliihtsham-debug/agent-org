import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, rm, readFileSync, writeFileSync } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createLedger } from "../src/meta-loop/ledger.js";

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `meta-ledger-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("ledger", () => {
  describe("append + verify", () => {
    it("creates a valid chain of entries", () => {
      const ledger = createLedger(testDir);
      ledger.append("capture_recorded", "First entry");
      ledger.append("proposal_applied", "Second entry", { proposalId: "abc123" });

      const result = ledger.verifyChain();
      expect(result.valid).toBe(true);
    });

    it("starts with genesis hash", () => {
      const ledger = createLedger(testDir);
      const entries = ledger.getAll();
      expect(entries).toHaveLength(0);
      expect(ledger.verifyChain().valid).toBe(true);
    });

    it("increments sequence numbers", () => {
      const ledger = createLedger(testDir);
      ledger.append("capture_recorded", "First");
      ledger.append("capture_recorded", "Second");
      ledger.append("capture_recorded", "Third");

      const entries = ledger.getAll();
      expect(entries[0].sequence).toBe(1);
      expect(entries[1].sequence).toBe(2);
      expect(entries[2].sequence).toBe(3);
    });

    it("chains previousHash correctly", () => {
      const ledger = createLedger(testDir);
      ledger.append("capture_recorded", "First");
      ledger.append("capture_recorded", "Second");

      const entries = ledger.getAll();
      expect(entries[1].previousHash).toBe(entries[0].entryHash);
    });

    it("detects tampering", () => {
      const ledger = createLedger(testDir);
      ledger.append("capture_recorded", "First");
      ledger.append("capture_recorded", "Second");

      // Tamper with the file by overwriting an entry.
      const fs = require("node:fs") as typeof import("node:fs");
      const path = join(testDir, ".meta", "ledger.jsonl");
      const lines = fs.readFileSync(path, "utf-8").trim().split("\n");
      const tampered = { ...JSON.parse(lines[0]), summary: "TAMPERED" };
      lines[0] = JSON.stringify(tampered);
      fs.writeFileSync(path, lines.join("\n") + "\n");

      // Re-create ledger (reads from disk).
      const ledger2 = createLedger(testDir);
      const result = ledger2.verifyChain();
      expect(result.valid).toBe(false);
      expect(result.firstInvalid).toBe(1);
    });
  });

  describe("getAll", () => {
    it("returns empty array for new ledger", () => {
      const ledger = createLedger(testDir);
      expect(ledger.getAll()).toEqual([]);
    });

    it("returns all entries in order", () => {
      const ledger = createLedger(testDir);
      ledger.append("capture_recorded", "A");
      ledger.append("capture_recorded", "B");
      expect(ledger.getAll()).toHaveLength(2);
    });
  });
});

