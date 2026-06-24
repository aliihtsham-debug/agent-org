import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createFindingStore, generateFindingId } from "../src/meta-loop/finding-store.js";

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `meta-finding-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("finding-store", () => {
  describe("generateFindingId", () => {
    it("produces stable IDs for the same input", () => {
      const id1 = generateFindingId("security-auditor", "backend-engineer", "Missing input validation");
      const id2 = generateFindingId("security-auditor", "backend-engineer", "Missing input validation");
      expect(id1).toBe(id2);
    });

    it("produces different IDs for different inputs", () => {
      const id1 = generateFindingId("security-auditor", "backend-engineer", "Finding A");
      const id2 = generateFindingId("security-auditor", "backend-engineer", "Finding B");
      expect(id1).not.toBe(id2);
    });

    it("is case-insensitive", () => {
      const id1 = generateFindingId("security-auditor", "backend-engineer", "Missing Input");
      const id2 = generateFindingId("security-auditor", "backend-engineer", "missing input");
      expect(id1).toBe(id2);
    });
  });

  describe("recordFindings", () => {
    it("records new findings", () => {
      const store = createFindingStore(testDir);
      const ids = store.recordFindings("run-1", "security-auditor", "backend-engineer", [
        "Missing input validation",
        "No rate limiting",
      ]);
      expect(ids).toHaveLength(2);

      const all = store.readAll();
      expect(all).toHaveLength(2);
      expect(all[0].occurrenceCount).toBe(1);
      expect(all[0].status).toBe("open");
    });

    it("increments occurrence for duplicate findings", () => {
      const store = createFindingStore(testDir);
      store.recordFindings("run-1", "security-auditor", "backend-engineer", ["Missing input"]);
      store.recordFindings("run-2", "security-auditor", "backend-engineer", ["Missing input"]);

      const all = store.readAll();
      expect(all).toHaveLength(1);
      expect(all[0].occurrenceCount).toBe(2);
      expect(all[0].firstSeenRunId).toBe("run-1");
      expect(all[0].lastSeenRunId).toBe("run-2");
    });
  });

  describe("markAddressed", () => {
    it("marks finding as addressed", () => {
      const store = createFindingStore(testDir);
      const ids = store.recordFindings("run-1", "security-auditor", "backend-engineer", ["Missing input"]);
      store.markAddressed(ids[0], "run-2");

      const all = store.readAll();
      expect(all[0].status).toBe("addressed");
      expect(all[0].addressedCount).toBe(1);
    });
  });

  describe("getFixAcceptanceRate", () => {
    it("returns 0 when no findings exist", () => {
      const store = createFindingStore(testDir);
      expect(store.getFixAcceptanceRate()).toBe(0);
    });

    it("calculates correct rate", () => {
      const store = createFindingStore(testDir);
      const ids = store.recordFindings("run-1", "security-auditor", "backend-engineer", ["A", "B", "C"]);
      store.markAddressed(ids[0], "run-2");
      store.markAddressed(ids[1], "run-2");
      // 2 addressed out of 3 occurrences = 0.667
      expect(store.getFixAcceptanceRate()).toBeCloseTo(2 / 3, 2);
    });
  });

  describe("getRecurringFindings", () => {
    it("returns findings seen >= N times", () => {
      const store = createFindingStore(testDir);
      store.recordFindings("run-1", "security-auditor", "backend-engineer", ["Repeated"]);
      store.recordFindings("run-2", "security-auditor", "backend-engineer", ["Repeated"]);
      store.recordFindings("run-3", "security-auditor", "backend-engineer", ["One-off"]);

      const recurring = store.getRecurringFindings(2);
      expect(recurring).toHaveLength(1);
      expect(recurring[0].findingText).toBe("Repeated");
    });
  });
});
