import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { applyCEOConfigEdit, TUNABLE_LEVERS } from "../src/meta-loop/ceo-config-editor.js";
import type { ProposedChange } from "../src/types/meta-types.js";

let testDir: string;
let projectDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `meta-ceo-editor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  projectDir = join(testDir, "project");
  await mkdir(testDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function makeProposal(overrides: Partial<ProposedChange> = {}): ProposedChange {
  return {
    proposalId: "test-prop-001",
    createdAt: new Date().toISOString(),
    sourceFile: "src/orchestrator/ceo-agent.ts",
    patch: JSON.stringify({}),
    beforeHash: "hash1",
    afterHash: "hash2",
    category: "ceo-config",
    ruleId: "rule_test",
    confidence: 0.9,
    signals: ["signal1"],
    status: "pending",
    provenance: { runId: "run-1", ruleId: "rule_test" },
    ...overrides,
  };
}

describe("ceo-config-editor", () => {
  describe("applyCEOConfigEdit", () => {
    it("tunes a numeric lever", async () => {
      const srcDir = join(projectDir, "src", "orchestrator");
      await mkdir(srcDir, { recursive: true });
      const srcFile = join(srcDir, "ceo-agent.ts");
      const content = `
const DEFAULT_CONFIG = {
  maxIterations: 1,
  maxConcurrent: 3,
  escalationThreshold: 5,
};
`;
      await writeFile(srcFile, content);

      const proposal = makeProposal({
        sourceFile: "src/orchestrator/ceo-agent.ts",
        patch: JSON.stringify({
          lever: "maxIterations",
          fromValue: 1,
          toValue: 2,
        }),
      });

      const result = await applyCEOConfigEdit(proposal, projectDir);
      expect(result.success).toBe(true);

      const newContent = await readFile(srcFile, "utf-8");
      expect(newContent).toContain("maxIterations: 2");
      expect(newContent).not.toContain("maxIterations: 1");
    });

    it("rejects non-tunable lever", async () => {
      const srcDir = join(projectDir, "src", "orchestrator");
      await mkdir(srcDir, { recursive: true });
      const srcFile = join(srcDir, "ceo-agent.ts");
      await writeFile(srcFile, "const x = 1;");

      const proposal = makeProposal({
        sourceFile: "src/orchestrator/ceo-agent.ts",
        patch: JSON.stringify({
          lever: "notATunableLever",
          fromValue: 1,
          toValue: 2,
        }),
      });

      const result = await applyCEOConfigEdit(proposal, projectDir);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not tunable");
    });

    it("returns error when lever value not found", async () => {
      const srcDir = join(projectDir, "src", "orchestrator");
      await mkdir(srcDir, { recursive: true });
      const srcFile = join(srcDir, "ceo-agent.ts");
      await writeFile(srcFile, "const x = 99;");

      const proposal = makeProposal({
        sourceFile: "src/orchestrator/ceo-agent.ts",
        patch: JSON.stringify({
          lever: "maxIterations",
          fromValue: 1,
          toValue: 2,
        }),
      });

      const result = await applyCEOConfigEdit(proposal, projectDir);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("returns error for invalid patch", async () => {
      const proposal = makeProposal({
        patch: "not json",
      });

      const result = await applyCEOConfigEdit(proposal, projectDir);
      expect(result.success).toBe(false);
    });
  });

  describe("TUNABLE_LEVERS", () => {
    it("contains expected levers", () => {
      expect(TUNABLE_LEVERS).toContain("maxIterations");
      expect(TUNABLE_LEVERS).toContain("minSeverity");
      expect(TUNABLE_LEVERS).toContain("maxConcurrent");
      expect(TUNABLE_LEVERS).toContain("escalationThreshold");
      expect(TUNABLE_LEVERS).toContain("reputationDelta");
      expect(TUNABLE_LEVERS).toContain("memoryImportance");
    });

    it("has exactly 6 tunable levers", () => {
      expect(TUNABLE_LEVERS).toHaveLength(6);
    });
  });
});
