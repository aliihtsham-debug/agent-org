import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { collectRunSignals, readCritiques } from "../src/meta-loop/run-collector.js";
import type { AgentResult } from "../src/types/agent-types.js";
import type { CritiqueResult } from "../src/types/agent-types.js";

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `meta-collector-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function makeResult(role: string, status: "completed" | "partial" | "failed" = "completed"): AgentResult {
  return {
    role: role as AgentResult["role"],
    status,
    outputPath: join(testDir, "outputs", role, "output.md"),
    summary: `${role} summary`,
    artifacts: [`${testDir}/outputs/${role}/output.md`],
    tokenUsage: { input: 1000, output: 500 },
    durationMs: 5000,
  };
}

describe("run-collector", () => {
  describe("collectRunSignals", () => {
    it("computes aggregate token usage", async () => {
      const vpResults = [makeResult("pm"), makeResult("cto")];
      const icResults = [makeResult("backend-engineer")];

      const summary = await collectRunSignals(
        testDir,
        "run-1",
        "test idea",
        "complete",
        vpResults,
        icResults,
      );

      expect(summary.totalTokens.input).toBe(3000);
      expect(summary.totalTokens.output).toBe(1500);
    });

    it("computes max duration across agents", async () => {
      const vpResults = [
        { ...makeResult("pm"), durationMs: 1000 },
        { ...makeResult("cto"), durationMs: 5000 },
      ];

      const summary = await collectRunSignals(testDir, "run-1", "idea", "complete", vpResults, []);
      expect(summary.totalDurationMs).toBe(5000);
    });

    it("counts actionable critiques (critical + high)", async () => {
      const critiques: CritiqueResult[] = [
        { reviewer: "security-auditor", reviewee: "backend-engineer", critique: "test", severity: "critical", findings: ["f1"] },
        { reviewer: "security-auditor", reviewee: "backend-engineer", critique: "test", severity: "high", findings: ["f2"] },
        { reviewer: "security-auditor", reviewee: "backend-engineer", critique: "test", severity: "medium", findings: ["f3"] },
      ];

      const summary = await collectRunSignals(testDir, "run-1", "idea", "complete", [], [], critiques);
      expect(summary.actionableCritiques).toBe(2);
      expect(summary.critiqueBreakdown.critical).toBe(1);
      expect(summary.critiqueBreakdown.high).toBe(1);
      expect(summary.critiqueBreakdown.medium).toBe(1);
    });

    it("hashes the idea for privacy", async () => {
      const summary = await collectRunSignals(testDir, "run-1", "my secret idea", "complete", [], []);
      expect(summary.ideaHash).toMatch(/^[a-f0-9]{16}$/);
    });

    it("builds per-role metrics", async () => {
      const vpResults = [makeResult("pm"), makeResult("cto")];
      const summary = await collectRunSignals(testDir, "run-1", "idea", "complete", vpResults, []);
      expect(summary.roleMetrics["pm"]).toBeDefined();
      expect(summary.roleMetrics["pm"].status).toBe("completed");
      expect(summary.roleMetrics["pm"].tokenUsage.input).toBe(1000);
    });
  });

  describe("readCritiques", () => {
    it("returns empty array when no critiques directory", async () => {
      const critiques = await readCritiques(testDir);
      expect(critiques).toEqual([]);
    });

    it("reads critique JSON files", async () => {
      const critDir = join(testDir, "refinement", "critiques");
      await mkdir(critDir, { recursive: true });
      const critique = {
        reviewer: "security-auditor",
        reviewee: "backend-engineer",
        severity: "high",
        findings: ["Missing input validation"],
        summary: "Security issues found",
      };
      await writeFile(join(critDir, "security-auditor-backend-engineer.json"), JSON.stringify(critique));

      const critiques = await readCritiques(testDir);
      expect(critiques).toHaveLength(1);
      expect(critiques[0].reviewer).toBe("security-auditor");
    });
  });
});
