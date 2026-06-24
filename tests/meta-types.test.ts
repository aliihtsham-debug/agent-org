import { describe, it, expect } from "vitest";
import type { RunSummary, ProposedChange, MetaLoopConfig, ProposalStatus } from "../src/types/meta-types.js";
import { DEFAULT_META_LOOP_CONFIG } from "../src/types/meta-types.js";

describe("meta-types", () => {
  describe("DEFAULT_META_LOOP_CONFIG", () => {
    it("has sensible defaults", () => {
      expect(DEFAULT_META_LOOP_CONFIG.enabled).toBe(false);
      expect(DEFAULT_META_LOOP_CONFIG.mode).toBe("advisory");
      expect(DEFAULT_META_LOOP_CONFIG.windowSize).toBe(10);
      expect(DEFAULT_META_LOOP_CONFIG.minConfidence).toBe(0.8);
      expect(DEFAULT_META_LOOP_CONFIG.maxPromptEditsPerRun).toBe(1);
      expect(DEFAULT_META_LOOP_CONFIG.requireHumanGate).toBe(true);
    });

    it("has debounce set to 5 minutes", () => {
      expect(DEFAULT_META_LOOP_CONFIG.debounceMs).toBe(300_000);
    });
  });

  describe("RunSummary shape", () => {
    it("can be constructed with required fields", () => {
      const summary: RunSummary = {
        runId: "test-run-1",
        timestamp: new Date().toISOString(),
        ideaHash: "abc123",
        status: "complete",
        totalAgents: 10,
        totalTokens: { input: 5000, output: 3000 },
        totalDurationMs: 15000,
        actionableCritiques: 2,
        critiqueBreakdown: { critical: 0, high: 2, medium: 3, low: 1, none: 0 },
        governanceDenials: 0,
        appliedProposalIds: [],
        promptVersion: "hash1",
        governanceVersion: "hash2",
        roleMetrics: {},
      };
      expect(summary.runId).toBe("test-run-1");
      expect(summary.status).toBe("complete");
      expect(summary.totalAgents).toBe(10);
    });
  });

  describe("ProposedChange shape", () => {
    it("can be constructed with all fields", () => {
      const proposal: ProposedChange = {
        proposalId: "prop-123",
        createdAt: new Date().toISOString(),
        sourceFile: "src/prompts/agent-prompts.ts",
        patch: "--- old\n+++ new",
        beforeHash: "hash1",
        afterHash: "hash2",
        category: "prompt",
        ruleId: "rule_test",
        confidence: 0.9,
        signals: ["signal1"],
        status: "pending",
        provenance: { runId: "run-1", ruleId: "rule_test" },
      };
      expect(proposal.status).toBe("pending");
      expect(proposal.category).toBe("prompt");
      expect(proposal.confidence).toBe(0.9);
    });
  });

  describe("ProposalStatus lifecycle", () => {
    it("has valid state transitions", () => {
      const statuses: ProposalStatus[] = ["pending", "applied", "rejected", "rolled-back", "superseded"];
      expect(statuses).toHaveLength(5);
      expect(statuses).toContain("pending");
      expect(statuses).toContain("applied");
    });
  });
});
