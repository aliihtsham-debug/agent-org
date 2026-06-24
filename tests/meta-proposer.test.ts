import { describe, it, expect } from "vitest";
import { evaluateAllRules, ALL_PROPOSER_RULES, rule_criticalFindingRepeats, rule_tokenSaturation, rule_governanceDenialSpike, rule_emptyOutput, rule_lowFixAcceptance, rule_reputationDecline, rule_severityTrendUp } from "../src/meta-loop/proposer-rules.js";
import type { SignalWindow } from "../src/types/meta-types.js";

function makeWindow(overrides: Partial<SignalWindow> = {}): SignalWindow {
  return {
    windowSize: 5,
    roleWindows: {} as SignalWindow["roleWindows"],
    pairWindows: {},
    governanceDenials: {},
    fixAcceptanceRate: 0.5,
    totalRuns: 5,
    ...overrides,
  };
}

describe("proposer-rules", () => {
  describe("rule_criticalFindingRepeats", () => {
    it("fires when failure rate is high", () => {
      const window = makeWindow({
        roleWindows: {
          pm: {
            role: "pm",
            runCount: 5,
            failureRate: 0.6,
            avgTokenUtilization: 0.5,
            avgDurationMs: 5000,
            avgSeverity: 3,
            reputationTrend: 0,
            emptyOutputCount: 0,
          },
        },
      });

      const proposals = rule_criticalFindingRepeats.evaluate(window, {
        runId: "run-1",
        currentFileHashes: { "src/prompts/agent-prompts.ts": "hash" },
      });

      expect(proposals.length).toBeGreaterThan(0);
      expect(proposals[0].category).toBe("prompt");
      expect(proposals[0].ruleId).toBe("rule_criticalFindingRepeats");
    });

    it("does not fire when run count is too low", () => {
      const window = makeWindow({
        roleWindows: {
          pm: {
            role: "pm",
            runCount: 1,
            failureRate: 1,
            avgTokenUtilization: 0.5,
            avgDurationMs: 5000,
            avgSeverity: 3,
            reputationTrend: 0,
            emptyOutputCount: 0,
          },
        },
      });

      const proposals = rule_criticalFindingRepeats.evaluate(window, {
        runId: "run-1",
        currentFileHashes: {},
      });

      expect(proposals).toHaveLength(0);
    });
  });

  describe("rule_tokenSaturation", () => {
    it("fires when token utilization > 0.85", () => {
      const window = makeWindow({
        roleWindows: {
          cfo: {
            role: "cfo",
            runCount: 5,
            failureRate: 0,
            avgTokenUtilization: 0.9,
            avgDurationMs: 5000,
            avgSeverity: 0,
            reputationTrend: 0,
            emptyOutputCount: 0,
          },
        },
      });

      const proposals = rule_tokenSaturation.evaluate(window, {
        runId: "run-1",
        currentFileHashes: {},
      });

      expect(proposals).toHaveLength(1);
      expect(proposals[0].signals).toContain("token_util=0.90");
    });

    it("does not fire when utilization is low", () => {
      const window = makeWindow({
        roleWindows: {
          cfo: {
            role: "cfo",
            runCount: 5,
            failureRate: 0,
            avgTokenUtilization: 0.3,
            avgDurationMs: 5000,
            avgSeverity: 0,
            reputationTrend: 0,
            emptyOutputCount: 0,
          },
        },
      });

      const proposals = rule_tokenSaturation.evaluate(window, {
        runId: "run-1",
        currentFileHashes: {},
      });

      expect(proposals).toHaveLength(0);
    });
  });

  describe("rule_governanceDenialSpike", () => {
    it("fires when denials >= 5", () => {
      const window = makeWindow({
        governanceDenials: { "rule-123": 7 },
      });

      const proposals = rule_governanceDenialSpike.evaluate(window, {
        runId: "run-1",
        currentFileHashes: {},
      });

      expect(proposals).toHaveLength(1);
      expect(proposals[0].category).toBe("governance");
    });

    it("does not fire when denials are low", () => {
      const window = makeWindow({
        governanceDenials: { "rule-123": 2 },
      });

      const proposals = rule_governanceDenialSpike.evaluate(window, {
        runId: "run-1",
        currentFileHashes: {},
      });

      expect(proposals).toHaveLength(0);
    });
  });

  describe("rule_emptyOutput", () => {
    it("fires when empty output count >= 2", () => {
      const window = makeWindow({
        roleWindows: {
          "qa-manager": {
            role: "qa-manager",
            runCount: 3,
            failureRate: 0,
            avgTokenUtilization: 0.5,
            avgDurationMs: 5000,
            avgSeverity: 0,
            reputationTrend: 0,
            emptyOutputCount: 4,
          },
        },
      });

      const proposals = rule_emptyOutput.evaluate(window, {
        runId: "run-1",
        currentFileHashes: {},
      });

      expect(proposals).toHaveLength(1);
      expect(proposals[0].signals).toContain("empty_outputs=4");
    });
  });

  describe("evaluateAllRules", () => {
    it("deduplicates by sourceFile", () => {
      const window = makeWindow({
        roleWindows: {
          pm: {
            role: "pm",
            runCount: 5,
            failureRate: 0.8,
            avgTokenUtilization: 0.95,
            avgDurationMs: 5000,
            avgSeverity: 3,
            reputationTrend: 0,
            emptyOutputCount: 0,
          },
        },
      });

      // Both rule_criticalFindingRepeats and rule_tokenSaturation would fire
      // for "pm" but both target "src/prompts/agent-prompts.ts".
      // Dedup should keep only the first.
      const proposals = evaluateAllRules(window, {
        runId: "run-1",
        currentFileHashes: {},
      }, "propose");

      const promptProposals = proposals.filter((p) => p.sourceFile === "src/prompts/agent-prompts.ts");
      expect(promptProposals.length).toBe(1);
    });

    it("returns proposals sorted by rule order", () => {
      const window = makeWindow({
        roleWindows: {
          pm: {
            role: "pm",
            runCount: 5,
            failureRate: 0.8,
            avgTokenUtilization: 0.5,
            avgDurationMs: 5000,
            avgSeverity: 3,
            reputationTrend: 0,
            emptyOutputCount: 0,
          },
        },
        governanceDenials: { "rule-1": 10 },
      });

      const proposals = evaluateAllRules(window, {
        runId: "run-1",
        currentFileHashes: {},
      }, "propose");

      // Should have at least 2 proposals from different sources.
      const sources = new Set(proposals.map((p) => p.sourceFile));
      expect(sources.size).toBeGreaterThan(1);
    });
  });

  describe("ALL_PROPOSER_RULES", () => {
    it("has 7 rules", () => {
      expect(ALL_PROPOSER_RULES).toHaveLength(7);
    });

    it("each rule has required fields", () => {
      for (const rule of ALL_PROPOSER_RULES) {
        expect(rule.id).toMatch(/^rule_/);
        expect(typeof rule.description).toBe("string");
        expect(typeof rule.enabled).toBe("function");
        expect(typeof rule.evaluate).toBe("function");
      }
    });
  });

  describe("rule_lowFixAcceptance", () => {
    it("fires when fix acceptance rate is below 0.4", () => {
      const window = makeWindow({
        pairWindows: {
          "security-auditor:backend-engineer": {
            reviewer: "security-auditor",
            reviewee: "backend-engineer",
            totalCritiques: 10,
            avgFindingsCount: 3,
            severityDistribution: { critical: 5, high: 3, medium: 2, low: 0, none: 0 },
            fixAcceptanceRate: 0.3,
          },
        },
      });

      const proposals = rule_lowFixAcceptance.evaluate(window, {
        runId: "run-1",
        currentFileHashes: { "src/refinement/review-pairs.ts": "hash" },
      });

      expect(proposals.length).toBeGreaterThan(0);
      expect(proposals[0].ruleId).toBe("rule_lowFixAcceptance");
    });

    it("does not fire when fix acceptance rate is high", () => {
      const window = makeWindow({
        pairWindows: {
          "security-auditor:backend-engineer": {
            reviewer: "security-auditor",
            reviewee: "backend-engineer",
            totalCritiques: 10,
            avgFindingsCount: 3,
            severityDistribution: { critical: 1, high: 2, medium: 5, low: 2, none: 0 },
            fixAcceptanceRate: 0.8,
          },
        },
      });

      const proposals = rule_lowFixAcceptance.evaluate(window, {
        runId: "run-1",
        currentFileHashes: {},
      });

      expect(proposals).toHaveLength(0);
    });
  });

  describe("rule_reputationDecline", () => {
    it("fires when reliability drops >= 10 points", () => {
      const window = makeWindow({
        roleWindows: {
          "backend-engineer": {
            role: "backend-engineer",
            runCount: 5,
            failureRate: 0,
            avgTokenUtilization: 0.5,
            avgDurationMs: 5000,
            avgSeverity: 0,
            reputationTrend: -12,
            emptyOutputCount: 0,
          },
        },
      });

      const proposals = rule_reputationDecline.evaluate(window, {
        runId: "run-1",
        currentFileHashes: {},
      });

      expect(proposals.length).toBeGreaterThan(0);
      expect(proposals[0].category).toBe("ceo-config");
      expect(proposals[0].ruleId).toBe("rule_reputationDecline");
    });

    it("does not fire when reputation is stable", () => {
      const window = makeWindow({
        roleWindows: {
          "backend-engineer": {
            role: "backend-engineer",
            runCount: 5,
            failureRate: 0,
            avgTokenUtilization: 0.5,
            avgDurationMs: 5000,
            avgSeverity: 0,
            reputationTrend: -3,
            emptyOutputCount: 0,
          },
        },
      });

      const proposals = rule_reputationDecline.evaluate(window, {
        runId: "run-1",
        currentFileHashes: {},
      });

      expect(proposals).toHaveLength(0);
    });
  });

  describe("rule_severityTrendUp", () => {
    it("fires when avg severity > 2 and runCount >= 3", () => {
      const window = makeWindow({
        roleWindows: {
          "backend-engineer": {
            role: "backend-engineer",
            runCount: 5,
            failureRate: 0,
            avgTokenUtilization: 0.5,
            avgDurationMs: 5000,
            avgSeverity: 3.5,
            reputationTrend: 0,
            emptyOutputCount: 0,
          },
        },
      });

      const proposals = rule_severityTrendUp.evaluate(window, {
        runId: "run-1",
        currentFileHashes: { "src/refinement/review-pairs.ts": "hash" },
      });

      expect(proposals.length).toBeGreaterThan(0);
      expect(proposals[0].ruleId).toBe("rule_severityTrendUp");
    });

    it("does not fire when avg severity is low", () => {
      const window = makeWindow({
        roleWindows: {
          "backend-engineer": {
            role: "backend-engineer",
            runCount: 5,
            failureRate: 0,
            avgTokenUtilization: 0.5,
            avgDurationMs: 5000,
            avgSeverity: 1.5,
            reputationTrend: 0,
            emptyOutputCount: 0,
          },
        },
      });

      const proposals = rule_severityTrendUp.evaluate(window, {
        runId: "run-1",
        currentFileHashes: {},
      });

      expect(proposals).toHaveLength(0);
    });
  });

  describe("evaluateAllRules mode behavior", () => {
    it("returns empty in capture mode", () => {
      const window = makeWindow({
        roleWindows: {
          pm: {
            role: "pm",
            runCount: 5,
            failureRate: 0.8,
            avgTokenUtilization: 0.9,
            avgDurationMs: 5000,
            avgSeverity: 3,
            reputationTrend: 0,
            emptyOutputCount: 0,
          },
        },
      });

      const proposals = evaluateAllRules(window, {
        runId: "run-1",
        currentFileHashes: {},
      }, "capture");

      expect(proposals).toHaveLength(0);
    });

    it("returns proposals in propose mode", () => {
      const window = makeWindow({
        roleWindows: {
          pm: {
            role: "pm",
            runCount: 5,
            failureRate: 0.8,
            avgTokenUtilization: 0.9,
            avgDurationMs: 5000,
            avgSeverity: 3,
            reputationTrend: 0,
            emptyOutputCount: 0,
          },
        },
      });

      const proposals = evaluateAllRules(window, {
        runId: "run-1",
        currentFileHashes: {},
      }, "propose");

      expect(proposals.length).toBeGreaterThan(0);
    });
  });
});
