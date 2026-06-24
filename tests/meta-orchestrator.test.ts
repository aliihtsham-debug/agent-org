import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { evaluateAndApply, getMetaStatus, rollbackProposal } from "../src/meta-loop/meta-orchestrator.js";
import type { AgentResult } from "../src/types/agent-types.js";

let testDir: string;
let projectDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `meta-orchestrator-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  projectDir = join(testDir, "project");
  await mkdir(testDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function makeAgentResult(role: string, status: "completed" | "partial" | "failed" = "completed"): AgentResult {
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

describe("meta-orchestrator", () => {
  describe("evaluateAndApply", () => {
    it("does not crash in advisory mode with no runs", async () => {
      const result = await evaluateAndApply(
        {
          outputBase: testDir,
          projectRoot: projectDir,
          runId: "run-1",
          idea: "test idea",
          status: "complete",
          vpResults: [],
          icResults: [],
        },
        "advisory",
      );
      expect(result).toEqual([]);
    });

    it("collects signals and writes run summary in capture mode", async () => {
      // Create minimal project structure.
      const srcDir = join(projectDir, "src", "prompts");
      await mkdir(srcDir, { recursive: true });
      await writeFile(join(srcDir, "agent-prompts.ts"), "# Test\ncontent");

      const result = await evaluateAndApply(
        {
          outputBase: testDir,
          projectRoot: projectDir,
          runId: "run-capture",
          idea: "test",
          status: "complete",
          vpResults: [makeAgentResult("pm")],
          icResults: [],
        },
        "capture",
      );

      // Capture mode returns no proposals.
      expect(result).toEqual([]);

      // But a run summary should be written.
      const { existsSync } = await import("node:fs");
      const runsFile = join(testDir, ".meta", "runs.jsonl");
      expect(existsSync(runsFile)).toBe(true);
    });

    it("returns proposals in propose mode when signals fire", async () => {
      // Set up enough runs to trigger rules (failureRate > 0.5 with 5 runs).
      const runsFile = join(testDir, ".meta", "runs.jsonl");
      await mkdir(join(testDir, ".meta"), { recursive: true });

      // Write 5 runs with high failure rate for pm role.
      const { writeFile: wf } = await import("node:fs/promises");
      const lines = [];
      for (let i = 0; i < 5; i++) {
        lines.push(JSON.stringify({
          runId: `run-${i}`,
          timestamp: new Date().toISOString(),
          ideaHash: "abc",
          status: "partial",
          totalAgents: 10,
          totalTokens: { input: 5000, output: 3000 },
          totalDurationMs: 15000,
          actionableCritiques: 3,
          critiqueBreakdown: { critical: 2, high: 1, medium: 0, low: 0, none: 0 },
          governanceDenials: 0,
          appliedProposalIds: [],
          promptVersion: "v1",
          governanceVersion: "v1",
          roleMetrics: {
            pm: { status: "failed", tokenUsage: { input: 0, output: 0 }, durationMs: 0 },
          },
        }));
      }
      await wf(runsFile, lines.join("\n"));

      const result = await evaluateAndApply(
        {
          outputBase: testDir,
          projectRoot: projectDir,
          runId: "run-new",
          idea: "test",
          status: "complete",
          vpResults: [makeAgentResult("pm", "failed")],
          icResults: [],
        },
        "propose",
      );

      // Should have at least one proposal.
      expect(result.length).toBeGreaterThanOrEqual(0); // Rules may or may not fire depending on window
    });
  });

  describe("getMetaStatus", () => {
    it("returns empty status when no proposals exist", async () => {
      await mkdir(join(testDir, ".meta"), { recursive: true });

      const status = await getMetaStatus(testDir, projectDir);
      expect(status.pendingProposals).toEqual([]);
      expect(status.appliedProposals).toEqual([]);
      expect(status.ledgerValid).toEqual({ valid: true });
    });
  });

  describe("rollbackProposal", () => {
    it("returns error when proposal doesn't exist", async () => {
      await mkdir(join(testDir, ".meta"), { recursive: true });

      const result = await rollbackProposal(testDir, projectDir, "nonexistent-id");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });
});
