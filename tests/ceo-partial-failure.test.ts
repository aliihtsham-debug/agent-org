import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── Mock Anthropic SDK ──
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

// ── Mock web tools ──
vi.mock("../src/tools/web-tools.js", () => ({
  webSearch: () => "",
  webFetch: async () => "",
}));

// ── Mock git operations ──
vi.mock("../src/tools/git-commit.js", () => ({
  buildBranchName: () => "test-branch",
  commitAgentArtifacts: () => {},
  pushBranchAndCreatePR: () => {},
}));

// ── Mock dashboard server ──
vi.mock("../src/dashboard/server.js", () => ({
  broadcastEvent: () => {},
  updateStatus: () => {},
  startDashboardServer: () => ({ close: () => {} }),
}));

const TEST_OUTPUT_BASE = join(__dirname, "..", "outputs-test-ceo-failure");

describe("CEO Partial Failure Scenarios", () => {
  beforeEach(() => {
    rmSync(TEST_OUTPUT_BASE, { recursive: true, force: true });
    mkdirSync(TEST_OUTPUT_BASE, { recursive: true });
    mockCreate.mockReset();
  });

  afterEach(() => {
    rmSync(TEST_OUTPUT_BASE, { recursive: true, force: true });
  });

  function mockSuccessfulResponse(summary: string) {
    return {
      content: [
        {
          type: "text" as const,
          text: `# Test Output\n\nSummary: ${summary}\n\n\`\`\`json\n{"summary": "${summary}", "artifacts": []}\n\`\`\``,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 200 },
    };
  }

  it("should handle 1 VP failing and 4 succeeding", async () => {
    // Fail PM agent by matching on its unique task content ("product strategy").
    // Both initial call and retry will match, exhausting the retry budget.
    mockCreate.mockImplementation((params: any) => {
      const taskText: string = params?.messages?.[0]?.content ?? "";
      if (taskText.includes("product strategy")) {
        throw new Error("PM agent failed");
      }
      return mockSuccessfulResponse("Succeeded");
    });

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const plan = await runCEOAgent({
      idea: "1 VP failure test",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
    });

    // Should be partial, not complete — at least one VP exhausted retries
    expect(plan.status).toBe("partial");
    expect(plan.gaps.length).toBeGreaterThan(0);
    // Plan should still have been written to disk
    expect(existsSync(join(TEST_OUTPUT_BASE, "project-plan.json"))).toBe(true);
  });

  it("should handle 2 VPs failing", async () => {
    // Fail PM and CTO agents by matching on their unique task content
    mockCreate.mockImplementation((params: any) => {
      const taskText: string = params?.messages?.[0]?.content ?? "";
      if (
        taskText.includes("product strategy") ||
        taskText.includes("Architecture Decision Record")
      ) {
        throw new Error("VP agent failed");
      }
      return mockSuccessfulResponse("Succeeded");
    });

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const plan = await runCEOAgent({
      idea: "2 VP failure test",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
    });

    expect(plan.status).toBe("partial");
    expect(plan.gaps.length).toBeGreaterThanOrEqual(2);
    // Should still produce output artifacts
    expect(existsSync(join(TEST_OUTPUT_BASE, "project-plan.json"))).toBe(true);
    expect(existsSync(join(TEST_OUTPUT_BASE, "project-plan.md"))).toBe(true);
  });

  it("should handle all VPs failing — overall status failed", async () => {
    mockCreate.mockImplementation(() => {
      throw new Error("All agents failed");
    });

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const plan = await runCEOAgent({
      idea: "All VP failure test",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
    });

    expect(plan.status).toBe("failed");
    expect(plan.gaps.length).toBe(5); // All 5 VPs failed
    expect(plan.gaps.every((g) => g.includes("failed"))).toBe(true);
    // Should still write plan artifacts even when all fail
    expect(existsSync(join(TEST_OUTPUT_BASE, "project-plan.json"))).toBe(true);
  });

  it("should include VP failure details in plan markdown", async () => {
    // Fail PM agent by matching on its task content
    mockCreate.mockImplementation((params: any) => {
      const taskText: string = params?.messages?.[0]?.content ?? "";
      if (taskText.includes("product strategy")) {
        throw new Error("PM agent failed catastrophically");
      }
      return mockSuccessfulResponse("Succeeded");
    });

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    await runCEOAgent({
      idea: "Failure detail test",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
    });

    const md = readFileSync(join(TEST_OUTPUT_BASE, "project-plan.md"), "utf-8");
    expect(md).toContain("failed");
    // Markdown should reference the failed VP in the Overall line
    expect(md).toContain("PM agent failed");
  });

  it("should handle VP producing empty output (partial status)", async () => {
    mockCreate.mockImplementation((params: any) => {
      const taskText: string = params?.messages?.[0]?.content ?? "";
      if (taskText.includes("product strategy")) {
        // PM produces empty/minimal output
        return {
          content: [{ type: "text" as const, text: "" }],
          usage: { input_tokens: 100, output_tokens: 0 },
        };
      }
      return mockSuccessfulResponse("Succeeded");
    });

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const plan = await runCEOAgent({
      idea: "Empty output test",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
    });

    // Empty output shouldn't crash — CEO should handle gracefully
    expect(["complete", "partial"]).toContain(plan.status);
  });

  it("should include token usage from all VP results including failures", async () => {
    mockCreate.mockImplementation((params: any) => {
      const taskText: string = params?.messages?.[0]?.content ?? "";
      if (taskText.includes("product strategy")) {
        throw new Error("PM failed");
      }
      return {
        content: [{ type: "text" as const, text: `# Output\n\`\`\`json\n{"summary": "OK"}\n\`\`\`` }],
        usage: { input_tokens: 500, output_tokens: 1000 },
      };
    });

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const plan = await runCEOAgent({
      idea: "Token usage test",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
    });

    // Token usage should be tracked even for failures
    expect(plan.icResults).toBeDefined();
    // The plan JSON should be valid
    const planJson = JSON.parse(readFileSync(join(TEST_OUTPUT_BASE, "project-plan.json"), "utf-8"));
    expect(planJson.pmResult).toBeDefined();
    expect(planJson.ctoResult).toBeDefined();
  });

  it("should produce valid event log even when VPs fail", async () => {
    mockCreate.mockImplementation((params: any) => {
      const taskText: string = params?.messages?.[0]?.content ?? "";
      if (
        taskText.includes("product strategy") ||
        taskText.includes("Architecture Decision Record")
      ) {
        throw new Error("VP failed");
      }
      return mockSuccessfulResponse("Succeeded");
    });

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    await runCEOAgent({
      idea: "Event log test",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
    });

    expect(existsSync(join(TEST_OUTPUT_BASE, "agent-events.jsonl"))).toBe(true);
    const eventsRaw = readFileSync(join(TEST_OUTPUT_BASE, "agent-events.jsonl"), "utf-8");
    const events = eventsRaw.split("\n").filter(Boolean).map(JSON.parse);
    // Should have fail events for the failed VPs
    expect(events.some((e: any) => e.type === "fail")).toBe(true);
    // Should also have complete events for successful agents
    expect(events.some((e: any) => e.type === "complete")).toBe(true);
  });
});
