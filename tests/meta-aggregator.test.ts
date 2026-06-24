import { describe, it, expect } from "vitest";
import { aggregateRuns, readLastNRuns } from "../src/meta-loop/aggregator.js";
import type { RunSummary } from "../src/types/meta-types.js";

function makeRun(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: `run-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    ideaHash: "abc123",
    status: "complete",
    totalAgents: 10,
    totalTokens: { input: 5000, output: 3000 },
    totalDurationMs: 15000,
    actionableCritiques: 0,
    critiqueBreakdown: { critical: 0, high: 0, medium: 0, low: 0, none: 0 },
    governanceDenials: 0,
    appliedProposalIds: [],
    promptVersion: "hash1",
    governanceVersion: "hash2",
    roleMetrics: {},
    ...overrides,
  };
}

describe("aggregator", () => {
  describe("aggregateRuns", () => {
    it("returns empty window for no runs", () => {
      const window = aggregateRuns([]);
      expect(window.totalRuns).toBe(0);
      expect(window.roleWindows).toEqual({});
    });

    it("computes failure rate per role", () => {
      const runs = [
        makeRun({ roleMetrics: { pm: { status: "failed", tokenUsage: { input: 0, output: 0 }, durationMs: 0 } } }),
        makeRun({ roleMetrics: { pm: { status: "completed", tokenUsage: { input: 1000, output: 500 }, durationMs: 5000 } } }),
        makeRun({ roleMetrics: { pm: { status: "failed", tokenUsage: { input: 0, output: 0 }, durationMs: 0 } } }),
      ];

      const window = aggregateRuns(runs);
      expect(window.roleWindows["pm"].failureRate).toBeCloseTo(2 / 3, 2);
      expect(window.roleWindows["pm"].runCount).toBe(3);
    });

    it("computes average token utilization", () => {
      const runs = [
        makeRun({ roleMetrics: { cto: { status: "completed", tokenUsage: { input: 1000, output: 3000 }, durationMs: 5000 } } }),
        makeRun({ roleMetrics: { cto: { status: "completed", tokenUsage: { input: 1000, output: 1000 }, durationMs: 5000 } } }),
      ];

      const window = aggregateRuns(runs);
      // Run 1: 3000/4000 = 0.75, Run 2: 1000/2000 = 0.5 → avg = 0.625
      expect(window.roleWindows["cto"].avgTokenUtilization).toBeCloseTo(0.625, 2);
    });

    it("computes average duration", () => {
      const runs = [
        makeRun({ roleMetrics: { cfo: { status: "completed", tokenUsage: { input: 0, output: 0 }, durationMs: 1000 } } }),
        makeRun({ roleMetrics: { cfo: { status: "completed", tokenUsage: { input: 0, output: 0 }, durationMs: 3000 } } }),
      ];

      const window = aggregateRuns(runs);
      expect(window.roleWindows["cfo"].avgDurationMs).toBe(2000);
    });

    it("aggregates governance denials", () => {
      const runs = [
        makeRun({ governanceDenials: 3 }),
        makeRun({ governanceDenials: 2 }),
      ];

      const window = aggregateRuns(runs);
      expect(window.governanceDenials["total"]).toBe(5);
    });

    it("returns empty pair windows when no critiques", () => {
      const runs = [makeRun(), makeRun()];
      const window = aggregateRuns(runs);
      expect(window.pairWindows).toEqual({});
    });

    it("creates aggregate pair window when critiques exist", () => {
      const runs = [
        makeRun({ critiqueBreakdown: { critical: 1, high: 2, medium: 0, low: 0, none: 0 } }),
      ];
      const window = aggregateRuns(runs);
      expect(window.pairWindows["aggregate:all"]).toBeDefined();
      expect(window.pairWindows["aggregate:all"].totalCritiques).toBe(3);
    });
  });
});
