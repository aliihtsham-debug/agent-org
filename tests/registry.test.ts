import { describe, it, expect, beforeEach } from "vitest";
import { AgentResultsRegistry } from "../src/communication/results-registry.js";
import type { AgentResult } from "../src/types/agent-types.js";

function makeResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    role: "cto",
    status: "completed",
    outputPath: "outputs/cto",
    summary: "All systems operational",
    artifacts: ["outputs/cto/output.md"],
    tokenUsage: { input: 100, output: 200 },
    durationMs: 500,
    ...overrides,
  };
}

describe("AgentResultsRegistry", () => {
  let registry: AgentResultsRegistry;

  beforeEach(() => {
    registry = new AgentResultsRegistry();
  });

  // ── Happy path ──

  it("should publish and retrieve a valid result", () => {
    const result = makeResult({ role: "cto" });
    registry.publish(result);
    expect(registry.get("cto")).toEqual(result);
  });

  it("should return the summary via getSummary", () => {
    registry.publish(makeResult({ role: "pm", summary: "PM summary text" }));
    expect(registry.getSummary("pm")).toBe("PM summary text");
  });

  it("should return empty string for unknown role via getSummary", () => {
    expect(registry.getSummary("cto")).toBe("");
  });

  it("should check existence via has()", () => {
    expect(registry.has("cto")).toBe(false);
    registry.publish(makeResult({ role: "cto" }));
    expect(registry.has("cto")).toBe(true);
  });

  it("should return all results via getAll", () => {
    registry.publish(makeResult({ role: "pm" }));
    registry.publish(makeResult({ role: "cto" }));
    const all = registry.getAll();
    expect(all.size).toBe(2);
    expect(all.get("pm")?.role).toBe("pm");
    expect(all.get("cto")?.role).toBe("cto");
  });

  it("should iterate via entries()", () => {
    registry.publish(makeResult({ role: "pm" }));
    registry.publish(makeResult({ role: "cto" }));
    const entries = [...registry.entries()];
    expect(entries.length).toBe(2);
    expect(entries[0][0]).toBe("pm");
    expect(entries[1][0]).toBe("cto");
  });

  it("should clear all results", () => {
    registry.publish(makeResult({ role: "pm" }));
    registry.publish(makeResult({ role: "cto" }));
    registry.clear();
    expect(registry.has("pm")).toBe(false);
    expect(registry.has("cto")).toBe(false);
  });

  it("should truncate summary exceeding 100,000 chars", () => {
    const longSummary = "x".repeat(150_000);
    registry.publish(makeResult({ role: "cto", summary: longSummary }));
    const stored = registry.get("cto")!;
    expect(stored.summary.length).toBeLessThan(longSummary.length);
    expect(stored.summary).toContain("[truncated by registry]");
  });

  it("should allow getSummary with maxLength", () => {
    registry.publish(makeResult({ role: "pm", summary: "A".repeat(500) }));
    const summary = registry.getSummary("pm", 100);
    expect(summary.length).toBe(100);
  });

  it("should overwrite on second publish for same role", () => {
    registry.publish(makeResult({ role: "cto", summary: "v1" }));
    registry.publish(makeResult({ role: "cto", summary: "v2" }));
    expect(registry.get("cto")!.summary).toBe("v2");
  });

  // ── Registry poisoning: invalid role ──

  it("should reject publish with empty role", () => {
    expect(() => registry.publish(makeResult({ role: "" } as AgentResult))).toThrow(
      "Registry publish rejected: missing or invalid role",
    );
  });

  it("should reject publish with unknown role", () => {
    expect(() =>
      registry.publish(makeResult({ role: "hacker" as AgentResult["role"] })),
    ).toThrow('Registry publish rejected: unknown role "hacker"');
  });

  it("should reject publish with role that is whitespace only", () => {
    expect(() =>
      registry.publish(makeResult({ role: "   " as AgentResult["role"] })),
    ).toThrow('Registry publish rejected: unknown role "   "');
  });

  it("should reject publish with role containing special injection chars", () => {
    expect(() =>
      registry.publish(makeResult({ role: "cto\ninjected" as AgentResult["role"] })),
    ).toThrow('Registry publish rejected: unknown role "cto\ninjected"');
  });

  // ── Registry poisoning: malformed data ──

  it("should reject publish with missing status", () => {
    expect(() => registry.publish(makeResult({ status: "" }))).toThrow(
      'Registry publish rejected for "cto": missing status',
    );
  });

  it("should reject publish with non-string status", () => {
    expect(() =>
      registry.publish(makeResult({ status: 123 as unknown as AgentResult["status"] })),
    ).toThrow('Registry publish rejected for "cto": missing status');
  });

  it("should reject publish with missing summary", () => {
    expect(() =>
      registry.publish(makeResult({ summary: undefined as unknown as string })),
    ).toThrow('Registry publish rejected for "cto": missing summary');
  });

  it("should reject publish with non-string summary", () => {
    expect(() =>
      registry.publish(makeResult({ summary: 42 as unknown as string })),
    ).toThrow('Registry publish rejected for "cto": missing summary');
  });

  it("should reject publish with missing artifacts array", () => {
    expect(() =>
      registry.publish(makeResult({ artifacts: undefined as unknown as string[] })),
    ).toThrow('Registry publish rejected for "cto": missing artifacts array');
  });

  it("should reject publish with non-array artifacts", () => {
    expect(() =>
      registry.publish(makeResult({ artifacts: "not-an-array" as unknown as string[] })),
    ).toThrow('Registry publish rejected for "cto": missing artifacts array');
  });

  it("should reject publish with missing tokenUsage", () => {
    expect(() =>
      registry.publish(makeResult({ tokenUsage: undefined as unknown as AgentResult["tokenUsage"] })),
    ).toThrow('Registry publish rejected for "cto": missing tokenUsage');
  });

  it("should reject publish with non-numeric tokenUsage.input", () => {
    expect(() =>
      registry.publish(makeResult({ tokenUsage: { input: "abc", output: 100 } })),
    ).toThrow('Registry publish rejected for "cto": missing tokenUsage');
  });

  it("should reject publish with non-numeric tokenUsage.output", () => {
    expect(() =>
      registry.publish(makeResult({ tokenUsage: { input: 100, output: null } })),
    ).toThrow('Registry publish rejected for "cto": missing tokenUsage');
  });

  // ── getAll returns a copy (not the internal map) ──

  it("should return a defensive copy from getAll", () => {
    registry.publish(makeResult({ role: "pm" }));
    const all = registry.getAll();
    // Mutating the returned map should not affect the registry
    (all as Map<string, AgentResult>).set("injected", makeResult({ role: "injected" as AgentResult["role"] }));
    expect(registry.has("injected" as AgentResult["role"])).toBe(false);
  });

  // ── All valid roles should be accepted ──

  const ALL_ROLES: AgentResult["role"][] = [
    "ceo", "cto", "pm", "frontend-engineer", "backend-engineer",
    "testing-agent", "security-auditor", "devops-agent",
    "engineering-manager", "qa-manager", "ai-engineer", "performance-agent",
    "ciso", "vuln-scanner", "compliance-agent",
    "cfo", "budget-agent", "pricing-agent",
    "coo", "scheduler-agent", "workflow-agent", "monitoring-agent",
    "ux-researcher", "roadmap-agent", "analytics-agent",
    "linear-mapper",
  ];

  it.each(ALL_ROLES)("should accept publish for valid role '%s'", (role) => {
    expect(() => registry.publish(makeResult({ role }))).not.toThrow();
  });
});
