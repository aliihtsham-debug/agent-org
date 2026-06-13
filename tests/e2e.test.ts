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

// ── Mock git operations to avoid triggering credential manager ──
vi.mock("../src/tools/git-commit.js", () => ({
  buildBranchName: () => "test-branch",
  commitAgentArtifacts: () => {},
  pushBranchAndCreatePR: () => {},
}));

// ── Mock dashboard server to avoid starting HTTP server ──
vi.mock("../src/dashboard/server.js", () => ({
  broadcastEvent: () => {},
  updateStatus: () => {},
  startDashboardServer: () => ({ close: () => {} }),
}));

const TEST_OUTPUT_BASE = join(__dirname, "..", "outputs-test");

describe("Agent Org E2E", () => {
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

  it("should produce a complete ProjectPlan with all VP results", async () => {
    mockCreate.mockResolvedValue(mockSuccessfulResponse("Test completed"));

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const plan = await runCEOAgent({
      idea: "Test product",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
    });

    // Verify plan structure
    expect(plan).toHaveProperty("idea", "Test product");
    expect(plan).toHaveProperty("status");
    expect(["complete", "partial"]).toContain(plan.status);
    expect(plan.pmResult).toBeDefined();
    expect(plan.ctoResult).toBeDefined();
    expect(plan.cisoResult).toBeDefined();
    expect(plan.cfoResult).toBeDefined();
    expect(plan.cooResult).toBeDefined();
    expect(plan.icResults.length).toBeGreaterThan(0);

    // Verify artifacts on disk
    expect(existsSync(join(TEST_OUTPUT_BASE, "project-plan.json"))).toBe(true);
    expect(existsSync(join(TEST_OUTPUT_BASE, "project-plan.md"))).toBe(true);

    // Verify event log
    expect(existsSync(join(TEST_OUTPUT_BASE, "agent-events.jsonl"))).toBe(true);
    const eventsRaw = readFileSync(join(TEST_OUTPUT_BASE, "agent-events.jsonl"), "utf-8");
    const events = eventsRaw.split("\n").filter(Boolean).map(JSON.parse);
    // At least CEO + 5 VPs spawned = 6 spawn events minimum
    expect(events.length).toBeGreaterThanOrEqual(6);
    expect(events.some((e: any) => e.type === "spawn")).toBe(true);

    // Verify artifact manifest
    expect(existsSync(join(TEST_OUTPUT_BASE, "artifact-manifest.json"))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(TEST_OUTPUT_BASE, "artifact-manifest.json"), "utf-8"));
    expect(manifest).toHaveProperty("artifacts");
    expect(Array.isArray(manifest.artifacts)).toBe(true);
  });

  it("should handle partial failures gracefully", async () => {
    let callCount = 0;
    mockCreate.mockImplementation(() => {
      callCount++;
      if (callCount % 3 === 0) {
        throw new Error("Simulated API failure");
      }
      return mockSuccessfulResponse("Completed despite failures");
    });

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const plan = await runCEOAgent({
      idea: "Failing product",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
    });

    // Should be partial, not completely failed (some calls succeed)
    expect(["partial", "complete"]).toContain(plan.status);
    expect(plan.gaps.length).toBeGreaterThan(0);

    // Event log should still exist
    expect(existsSync(join(TEST_OUTPUT_BASE, "agent-events.jsonl"))).toBe(true);
    const eventsRaw = readFileSync(join(TEST_OUTPUT_BASE, "agent-events.jsonl"), "utf-8");
    const events = eventsRaw.split("\n").filter(Boolean).map(JSON.parse);
    // Should have some fail events
    expect(events.some((e: any) => e.type === "fail")).toBe(true);
  });

  it("should produce structured events with correct types", async () => {
    mockCreate.mockResolvedValue(mockSuccessfulResponse("Event type test"));

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    await runCEOAgent({
      idea: "Event test",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
    });

    const eventsRaw = readFileSync(join(TEST_OUTPUT_BASE, "agent-events.jsonl"), "utf-8");
    const events = eventsRaw.split("\n").filter(Boolean).map(JSON.parse);

    // Every event should have type and timestamp
    for (const event of events) {
      expect(event).toHaveProperty("type");
      expect(event).toHaveProperty("timestamp");
      expect(typeof event.type).toBe("string");
      expect(typeof event.timestamp).toBe("string");
    }

    // Should have spawn and complete events
    const types = new Set(events.map((e: any) => e.type));
    expect(types.has("spawn")).toBe(true);
    expect(types.has("complete")).toBe(true);
  });

  it("should run refinement phase when --refine is enabled", async () => {
    let callCount = 0;
    mockCreate.mockImplementation(() => {
      callCount++;
      if (callCount <= 21) {
        // Pass 1: normal agent responses
        return {
          content: [
            {
              type: "text" as const,
              text: `# Output\n\n\`\`\`json\n{"summary": "Original output", "artifacts": []}\n\`\`\``,
            },
          ],
          usage: { input_tokens: 100, output_tokens: 200 },
        };
      }
      if (callCount <= 28) {
        // Review phase: return critiques
        return {
          content: [
            {
              type: "text" as const,
              text: `# Critique\n\nFound issues.\n\n\`\`\`json\n{"severity": "high", "findings": ["Issue 1"], "summary": "Found problems"}\n\`\`\``,
            },
          ],
          usage: { input_tokens: 100, output_tokens: 200 },
        };
      }
      // Refinement phase: return improved output
      return {
        content: [
          {
            type: "text" as const,
            text: `# Refined Output\n\n\`\`\`json\n{"summary": "Refined output", "artifacts": []}\n\`\`\``,
          },
        ],
        usage: { input_tokens: 100, output_tokens: 200 },
      };
    });

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const plan = await runCEOAgent({
      idea: "Refinement test product",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
      enableRefinement: true,
    });

    // Verify refinement report is present
    expect(plan.refinementReport).toBeDefined();
    expect(plan.refinementReport!.totalReviews).toBe(7);
    expect(plan.refinementReport!.critiques.length).toBeGreaterThan(0);
    expect(plan.refinementReport!.actionableCritiques).toBeGreaterThan(0);
    expect(plan.refinementReport!.refinedAgents.length).toBeGreaterThan(0);

    // Verify refinement artifacts on disk
    expect(existsSync(join(TEST_OUTPUT_BASE, "refinement", "summary.md"))).toBe(true);
    expect(existsSync(join(TEST_OUTPUT_BASE, "refinement", "critiques"))).toBe(true);

    // Verify the markdown plan includes refinement section
    const mdPlan = readFileSync(join(TEST_OUTPUT_BASE, "project-plan.md"), "utf-8");
    expect(mdPlan).toContain("Refinement");
  });
});
