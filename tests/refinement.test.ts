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

const TEST_OUTPUT_BASE = join(__dirname, "..", "outputs-test-refinement");

describe("Critique Parser", () => {
  beforeEach(() => {
    rmSync(TEST_OUTPUT_BASE, { recursive: true, force: true });
    mkdirSync(TEST_OUTPUT_BASE, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_OUTPUT_BASE, { recursive: true, force: true });
  });

  it("should parse structured critique with severity and findings", async () => {
    const { parseCritique } = await import("../src/refinement/critique-parser.js");

    const text = `Some critique text.

\`\`\`json
{
  "severity": "high",
  "findings": ["No rate limiting on auth endpoints", "Missing input validation"],
  "summary": "3 critical security gaps"
}
\`\`\``;

    const result = parseCritique(text, "security-auditor", "backend-engineer");

    expect(result.reviewer).toBe("security-auditor");
    expect(result.reviewee).toBe("backend-engineer");
    expect(result.severity).toBe("high");
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]).toBe("No rate limiting on auth endpoints");
    expect(result.critique).toBe("3 critical security gaps");
  });

  it("should fallback to full text when no JSON block found", async () => {
    const { parseCritique } = await import("../src/refinement/critique-parser.js");

    const text = "This is a plain text critique with no JSON.";
    const result = parseCritique(text, "testing-agent", "frontend-engineer");

    expect(result.reviewer).toBe("testing-agent");
    expect(result.reviewee).toBe("frontend-engineer");
    expect(result.severity).toBe("medium");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toBe("This is a plain text critique with no JSON.");
  });

  it("should default to medium severity for unknown severity values", async () => {
    const { parseCritique } = await import("../src/refinement/critique-parser.js");

    const text = `\`\`\`json
{
  "severity": "unknown",
  "findings": ["Issue 1"],
  "summary": "Summary"
}
\`\`\``;

    const result = parseCritique(text, "cto", "security-auditor");
    expect(result.severity).toBe("medium");
  });

  it("should handle empty findings array gracefully", async () => {
    const { parseCritique } = await import("../src/refinement/critique-parser.js");

    const text = `\`\`\`json
{
  "severity": "none",
  "findings": [],
  "summary": "No issues found"
}
\`\`\``;

    const result = parseCritique(text, "pm", "cto");
    expect(result.severity).toBe("none");
    expect(result.findings).toHaveLength(0);
    expect(result.critique).toBe("No issues found");
  });
});

describe("Review Pairs Config", () => {
  it("should define 7 default review pairs", async () => {
    const { DEFAULT_REVIEW_PAIRS } = await import("../src/refinement/review-pairs.js");

    expect(DEFAULT_REVIEW_PAIRS).toHaveLength(7);

    // Verify all pairs have required fields
    for (const pair of DEFAULT_REVIEW_PAIRS) {
      expect(pair.reviewer).toBeDefined();
      expect(pair.reviewee).toBeDefined();
      expect(pair.reviewFocus).toBeDefined();
      expect(pair.maxIterations).toBe(1);
    }
  });

  it("should include security-auditor reviewing cto", async () => {
    const { DEFAULT_REVIEW_PAIRS } = await import("../src/refinement/review-pairs.js");

    const pair = DEFAULT_REVIEW_PAIRS.find(
      (p) => p.reviewer === "security-auditor" && p.reviewee === "cto",
    );
    expect(pair).toBeDefined();
    expect(pair!.reviewFocus).toContain("security");
  });

  it("should include testing-agent reviewing backend-engineer", async () => {
    const { DEFAULT_REVIEW_PAIRS } = await import("../src/refinement/review-pairs.js");

    const pair = DEFAULT_REVIEW_PAIRS.find(
      (p) => p.reviewer === "testing-agent" && p.reviewee === "backend-engineer",
    );
    expect(pair).toBeDefined();
    expect(pair!.reviewFocus).toContain("Testability");
  });
});

describe("Refinement Prompts", () => {
  it("should generate a review system prompt with the review focus", async () => {
    const { getReviewSystemPrompt } = await import("../src/prompts/refinement-prompts.js");

    const pair = {
      reviewer: "security-auditor" as const,
      reviewee: "cto" as const,
      reviewFocus: "Security flaws in the architecture",
      maxIterations: 1,
    };

    const prompt = getReviewSystemPrompt(pair);

    expect(prompt).toContain("security-auditor");
    expect(prompt).toContain("Security flaws in the architecture");
    expect(prompt).toContain("severity");
    expect(prompt).toContain("findings");
  });

  it("should generate a review user message with reviewee output", async () => {
    const { getReviewUserMessage } = await import("../src/prompts/refinement-prompts.js");

    const pair = {
      reviewer: "testing-agent" as const,
      reviewee: "backend-engineer" as const,
      reviewFocus: "API testability",
      maxIterations: 1,
    };

    const msg = getReviewUserMessage(pair, "The API uses REST with JWT auth...", "Test idea");

    expect(msg).toContain("Test idea");
    expect(msg).toContain("backend-engineer");
    expect(msg).toContain("API testability");
    expect(msg).toContain("The API uses REST with JWT auth...");
  });

  it("should generate a refinement system prompt that includes the base prompt", async () => {
    const { getRefinementSystemPrompt } = await import("../src/prompts/refinement-prompts.js");

    const prompt = getRefinementSystemPrompt("backend-engineer");

    expect(prompt).toContain("Refinement Mode");
    expect(prompt).toContain("cross-functional review feedback");
    expect(prompt).toContain("Changes Made");
  });

  it("should generate a refinement user message with all critiques", async () => {
    const { getRefinementUserMessage } = await import("../src/prompts/refinement-prompts.js");

    const critiques = [
      {
        reviewer: "security-auditor" as const,
        reviewee: "backend-engineer" as const,
        critique: "API has security issues",
        severity: "high" as const,
        findings: ["No rate limiting", "Missing input validation"],
      },
    ];

    const msg = getRefinementUserMessage(
      "backend-engineer",
      "Original API design...",
      critiques,
      "Test idea",
    );

    expect(msg).toContain("Test idea");
    expect(msg).toContain("Original API design...");
    expect(msg).toContain("security-auditor");
    expect(msg).toContain("No rate limiting");
    expect(msg).toContain("Missing input validation");
    expect(msg).toContain("Changes Made");
  });
});

describe("Refinement Phase Integration", () => {
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

  function mockCritiqueResponse(severity: string, findings: string[], summary: string) {
    return {
      content: [
        {
          type: "text" as const,
          text: `# Critique\n\n${summary}\n\n\`\`\`json\n{"severity": "${severity}", "findings": ${JSON.stringify(findings)}, "summary": "${summary}"}\n\`\`\``,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 200 },
    };
  }

  it("should run refinement phase and produce critiques", async () => {
    // First 21 calls: normal agent responses (pass 1)
    // Next 7 calls: review responses
    // Final calls: refinement responses
    let callCount = 0;
    mockCreate.mockImplementation(() => {
      callCount++;
      if (callCount <= 21) {
        return mockSuccessfulResponse("Original output");
      }
      if (callCount <= 28) {
        return mockCritiqueResponse("high", ["Issue 1", "Issue 2"], "Found problems");
      }
      return mockSuccessfulResponse("Refined output");
    });

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const plan = await runCEOAgent({
      idea: "Test product with refinement",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
      enableRefinement: true,
    });

    // Verify refinement report exists
    expect(plan.refinementReport).toBeDefined();
    expect(plan.refinementReport!.totalReviews).toBe(7);
    expect(plan.refinementReport!.critiques.length).toBeGreaterThan(0);
    expect(plan.refinementReport!.actionableCritiques).toBeGreaterThan(0);
    expect(plan.refinementReport!.refinedAgents.length).toBeGreaterThan(0);

    // Verify refinement artifacts on disk
    expect(existsSync(join(TEST_OUTPUT_BASE, "refinement"))).toBe(true);
    expect(existsSync(join(TEST_OUTPUT_BASE, "refinement", "summary.md"))).toBe(true);
    expect(existsSync(join(TEST_OUTPUT_BASE, "refinement", "critiques"))).toBe(true);

    // Verify the plan includes refinement data
    const planJson = JSON.parse(readFileSync(join(TEST_OUTPUT_BASE, "project-plan.json"), "utf-8"));
    expect(planJson.refinementReport).toBeDefined();
    expect(planJson.refinementReport.totalReviews).toBe(7);
  });

  it("should skip refinement when enableRefinement is false", async () => {
    mockCreate.mockResolvedValue(mockSuccessfulResponse("Test completed"));

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const plan = await runCEOAgent({
      idea: "Test product no refinement",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
      enableRefinement: false,
    });

    expect(plan.refinementReport).toBeUndefined();
    expect(existsSync(join(TEST_OUTPUT_BASE, "refinement"))).toBe(false);
  });

  it("should filter out low-severity critiques", async () => {
    let callCount = 0;
    mockCreate.mockImplementation(() => {
      callCount++;
      if (callCount <= 21) {
        return mockSuccessfulResponse("Original output");
      }
      if (callCount <= 28) {
        // Return low-severity critiques — should be filtered out
        return mockCritiqueResponse("low", ["Minor issue"], "Low severity finding");
      }
      return mockSuccessfulResponse("Refined output");
    });

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const plan = await runCEOAgent({
      idea: "Test product low severity",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
      enableRefinement: true,
      refinementConfig: {
        enabled: true,
        maxIterations: 1,
        reviewPairs: [
          {
            reviewer: "security-auditor",
            reviewee: "cto",
            reviewFocus: "Security flaws",
            maxIterations: 1,
          },
        ],
        minSeverity: "high", // Only high and critical should be actionable
      },
    });

    expect(plan.refinementReport).toBeDefined();
    // All critiques are "low" severity, so none should be actionable
    expect(plan.refinementReport!.actionableCritiques).toBe(0);
    expect(plan.refinementReport!.refinedAgents).toHaveLength(0);
  });
});
