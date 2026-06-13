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

// ── Mock Linear SDK ──
const mockCreateIssue = vi.fn();
const mockCreateProject = vi.fn();
const mockCreateCycle = vi.fn();
const mockCreateIssueLabel = vi.fn();
const mockTeams = vi.fn();
const mockProjects = vi.fn();
const mockIssueLabels = vi.fn();

vi.mock("@linear/sdk", () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    teams: mockTeams,
    projects: mockProjects,
    issueLabels: mockIssueLabels,
    createIssue: mockCreateIssue,
    createProject: mockCreateProject,
    createCycle: mockCreateCycle,
    createIssueLabel: mockCreateIssueLabel,
  })),
}));

const TEST_OUTPUT_BASE = join(__dirname, "..", "outputs-test-linear-edge");

describe("Linear Mapper Edge Cases", () => {
  beforeEach(() => {
    rmSync(TEST_OUTPUT_BASE, { recursive: true, force: true });
    mkdirSync(TEST_OUTPUT_BASE, { recursive: true });
    mockCreate.mockReset();
    mockCreateIssue.mockReset();
    mockCreateProject.mockReset();
    mockCreateCycle.mockReset();
    mockCreateIssueLabel.mockReset();
    mockTeams.mockReset();
    mockProjects.mockReset();
    mockIssueLabels.mockReset();
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

  it("should handle mapper agent producing no JSON output", async () => {
    mockTeams.mockResolvedValue({ nodes: [{ id: "team-1", name: "Engineering" }] });
    mockProjects.mockResolvedValue({ nodes: [] });
    mockCreateProject.mockResolvedValue({
      get project() { return Promise.resolve({ id: "proj-1", url: "https://linear.app/test/project/proj-1" }); },
    });
    mockCreateIssueLabel.mockResolvedValue({
      get issueLabel() { return Promise.resolve({ id: "label-1" }); },
    });
    mockCreateCycle.mockResolvedValue({
      get cycle() { return Promise.resolve({ id: "cycle-1", number: 1, url: "https://linear.app/test/cycle/cycle-1" }); },
    });
    mockCreateIssue.mockResolvedValue({
      get issue() { return Promise.resolve({ id: "issue-1", url: "https://linear.app/test/issue/issue-1" }); },
    });

    let callCount = 0;
    mockCreate.mockImplementation(() => {
      callCount++;
      if (callCount <= 21) {
        return mockSuccessfulResponse("Original output");
      }
      // Mapper agent returns no JSON — just plain text
      return {
        content: [{ type: "text" as const, text: "# Linear Import\n\nI could not produce structured output." }],
        usage: { input_tokens: 100, output_tokens: 200 },
      };
    });

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const plan = await runCEOAgent({
      idea: "Mapper no JSON test",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
      linearApiKey: "lin_api_test_key",
    });

    // Should still complete — Linear sync is non-fatal
    expect(["complete", "partial"]).toContain(plan.status);
    // Linear sync should be undefined since mapper failed
    expect(plan.linearSync).toBeUndefined();
  });

  it("should handle mapper agent failing entirely", async () => {
    mockTeams.mockResolvedValue({ nodes: [{ id: "team-1", name: "Engineering" }] });
    mockProjects.mockResolvedValue({ nodes: [] });
    mockCreateProject.mockResolvedValue({
      get project() { return Promise.resolve({ id: "proj-1", url: "https://linear.app/test/project/proj-1" }); },
    });
    mockCreateIssueLabel.mockResolvedValue({
      get issueLabel() { return Promise.resolve({ id: "label-1" }); },
    });
    mockCreateCycle.mockResolvedValue({
      get cycle() { return Promise.resolve({ id: "cycle-1", number: 1, url: "https://linear.app/test/cycle/cycle-1" }); },
    });
    mockCreateIssue.mockResolvedValue({
      get issue() { return Promise.resolve({ id: "issue-1", url: "https://linear.app/test/issue/issue-1" }); },
    });

    let callCount = 0;
    mockCreate.mockImplementation(() => {
      callCount++;
      if (callCount <= 21) {
        return mockSuccessfulResponse("Original output");
      }
      // Mapper agent fails
      throw new Error("Mapper agent failed");
    });

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const plan = await runCEOAgent({
      idea: "Mapper failure test",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
      linearApiKey: "lin_api_test_key",
    });

    // Should still complete — Linear sync is non-fatal
    expect(["complete", "partial"]).toContain(plan.status);
    expect(plan.linearSync).toBeUndefined();
  });

  it("should handle Linear API returning no teams", async () => {
    mockTeams.mockResolvedValue({ nodes: [] });

    let callCount = 0;
    mockCreate.mockImplementation(() => {
      callCount++;
      if (callCount <= 21) {
        return mockSuccessfulResponse("Original output");
      }
      return {
        content: [{ type: "text" as const, text: `# Linear Import\n\n\`\`\`json\n{"projectName": "Test", "projectDescription": "Test", "labels": ["pm"], "cycles": [], "issues": [{"title": "Issue 1", "description": "Desc", "labels": ["pm"], "priority": "high"}], "metadata": {"agentCount": 21, "tokenUsage": {"input": 100, "output": 200}, "durationMs": 1000, "timestamp": "2026-06-14T00:00:00.000Z", "icSummaries": []}}\n\`\`\`` }],
        usage: { input_tokens: 100, output_tokens: 200 },
      };
    });

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const plan = await runCEOAgent({
      idea: "No teams test",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
      linearApiKey: "lin_api_test_key",
    });

    expect(["complete", "partial"]).toContain(plan.status);
    expect(plan.linearSync).toBeDefined();
    expect(plan.linearSync!.errors.length).toBeGreaterThan(0);
    expect(plan.linearSync!.errors[0]).toContain("No teams found");
  });

  it("should handle label creation failures gracefully", async () => {
    mockTeams.mockResolvedValue({ nodes: [{ id: "team-1", name: "Engineering" }] });
    mockProjects.mockResolvedValue({ nodes: [] });
    mockCreateProject.mockResolvedValue({
      get project() { return Promise.resolve({ id: "proj-1", url: "https://linear.app/test/project/proj-1" }); },
    });
    // Label creation fails
    mockCreateIssueLabel.mockRejectedValue(new Error("Label already exists"));
    mockIssueLabels.mockRejectedValue(new Error("Cannot query labels"));
    mockCreateCycle.mockResolvedValue({
      get cycle() { return Promise.resolve({ id: "cycle-1", number: 1, url: "https://linear.app/test/cycle/cycle-1" }); },
    });
    mockCreateIssue.mockResolvedValue({
      get issue() { return Promise.resolve({ id: "issue-1", url: "https://linear.app/test/issue/issue-1" }); },
    });

    let callCount = 0;
    mockCreate.mockImplementation(() => {
      callCount++;
      if (callCount <= 21) {
        return mockSuccessfulResponse("Original output");
      }
      return {
        content: [{ type: "text" as const, text: `# Linear Import\n\n\`\`\`json\n{"projectName": "Test", "projectDescription": "Test", "labels": ["pm", "cto"], "cycles": [], "issues": [{"title": "Issue 1", "description": "Desc", "labels": ["pm"], "priority": "high"}], "metadata": {"agentCount": 21, "tokenUsage": {"input": 100, "output": 200}, "durationMs": 1000, "timestamp": "2026-06-14T00:00:00.000Z", "icSummaries": []}}\n\`\`\`` }],
        usage: { input_tokens: 100, output_tokens: 200 },
      };
    });

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const plan = await runCEOAgent({
      idea: "Label failure test",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
      linearApiKey: "lin_api_test_key",
    });

    expect(["complete", "partial"]).toContain(plan.status);
    expect(plan.linearSync).toBeDefined();
    // Should have errors for label creation failures
    expect(plan.linearSync!.errors.length).toBeGreaterThan(0);
  });

  it("should handle issue creation failures gracefully", async () => {
    mockTeams.mockResolvedValue({ nodes: [{ id: "team-1", name: "Engineering" }] });
    mockProjects.mockResolvedValue({ nodes: [] });
    mockCreateProject.mockResolvedValue({
      get project() { return Promise.resolve({ id: "proj-1", url: "https://linear.app/test/project/proj-1" }); },
    });
    mockCreateIssueLabel.mockResolvedValue({
      get issueLabel() { return Promise.resolve({ id: "label-1" }); },
    });
    mockCreateCycle.mockResolvedValue({
      get cycle() { return Promise.resolve({ id: "cycle-1", number: 1, url: "https://linear.app/test/cycle/cycle-1" }); },
    });
    // Issue creation fails
    mockCreateIssue.mockRejectedValue(new Error("Invalid issue data"));

    let callCount = 0;
    mockCreate.mockImplementation(() => {
      callCount++;
      if (callCount <= 21) {
        return mockSuccessfulResponse("Original output");
      }
      return {
        content: [{ type: "text" as const, text: `# Linear Import\n\n\`\`\`json\n{"projectName": "Test", "projectDescription": "Test", "labels": ["pm"], "cycles": [], "issues": [{"title": "Issue 1", "description": "Desc", "labels": ["pm"], "priority": "high"}], "metadata": {"agentCount": 21, "tokenUsage": {"input": 100, "output": 200}, "durationMs": 1000, "timestamp": "2026-06-14T00:00:00.000Z", "icSummaries": []}}\n\`\`\`` }],
        usage: { input_tokens: 100, output_tokens: 200 },
      };
    });

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const plan = await runCEOAgent({
      idea: "Issue failure test",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
      linearApiKey: "lin_api_test_key",
    });

    expect(["complete", "partial"]).toContain(plan.status);
    expect(plan.linearSync).toBeDefined();
    // Should have errors for issue creation failures
    expect(plan.linearSync!.errors.length).toBeGreaterThan(0);
    expect(plan.linearSync!.skipped).toBeGreaterThan(0);
  });

  it("should handle empty issues list in mapper output", async () => {
    mockTeams.mockResolvedValue({ nodes: [{ id: "team-1", name: "Engineering" }] });
    mockProjects.mockResolvedValue({ nodes: [] });
    mockCreateProject.mockResolvedValue({
      get project() { return Promise.resolve({ id: "proj-1", url: "https://linear.app/test/project/proj-1" }); },
    });
    mockCreateIssueLabel.mockResolvedValue({
      get issueLabel() { return Promise.resolve({ id: "label-1" }); },
    });
    mockCreateCycle.mockResolvedValue({
      get cycle() { return Promise.resolve({ id: "cycle-1", number: 1, url: "https://linear.app/test/cycle/cycle-1" }); },
    });

    let callCount = 0;
    mockCreate.mockImplementation(() => {
      callCount++;
      if (callCount <= 21) {
        return mockSuccessfulResponse("Original output");
      }
      return {
        content: [{ type: "text" as const, text: `# Linear Import\n\n\`\`\`json\n{"projectName": "Test", "projectDescription": "Test", "labels": ["pm"], "cycles": [], "issues": [], "metadata": {"agentCount": 21, "tokenUsage": {"input": 100, "output": 200}, "durationMs": 1000, "timestamp": "2026-06-14T00:00:00.000Z", "icSummaries": []}}\n\`\`\`` }],
        usage: { input_tokens: 100, output_tokens: 200 },
      };
    });

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const plan = await runCEOAgent({
      idea: "Empty issues test",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
      linearApiKey: "lin_api_test_key",
    });

    expect(plan.linearSync).toBeDefined();
    expect(plan.linearSync!.issueUrls).toHaveLength(0);
    expect(plan.linearSync!.created).toBeGreaterThan(0); // Project + labels + cycles still created
  });

  it("should handle cycle creation failures gracefully", async () => {
    mockTeams.mockResolvedValue({ nodes: [{ id: "team-1", name: "Engineering" }] });
    mockProjects.mockResolvedValue({ nodes: [] });
    mockCreateProject.mockResolvedValue({
      get project() { return Promise.resolve({ id: "proj-1", url: "https://linear.app/test/project/proj-1" }); },
    });
    mockCreateIssueLabel.mockResolvedValue({
      get issueLabel() { return Promise.resolve({ id: "label-1" }); },
    });
    // Cycle creation fails
    mockCreateCycle.mockRejectedValue(new Error("Invalid date range"));
    mockCreateIssue.mockResolvedValue({
      get issue() { return Promise.resolve({ id: "issue-1", url: "https://linear.app/test/issue/issue-1" }); },
    });

    let callCount = 0;
    mockCreate.mockImplementation(() => {
      callCount++;
      if (callCount <= 21) {
        return mockSuccessfulResponse("Original output");
      }
      return {
        content: [{ type: "text" as const, text: `# Linear Import\n\n\`\`\`json\n{"projectName": "Test", "projectDescription": "Test", "labels": ["pm"], "cycles": [{"name": "Sprint 1", "startsAt": "2026-06-14T00:00:00.000Z", "endsAt": "2026-06-28T00:00:00.000Z"}], "issues": [{"title": "Issue 1", "description": "Desc", "labels": ["pm"], "priority": "high", "cycleName": "Sprint 1"}], "metadata": {"agentCount": 21, "tokenUsage": {"input": 100, "output": 200}, "durationMs": 1000, "timestamp": "2026-06-14T00:00:00.000Z", "icSummaries": []}}\n\`\`\`` }],
        usage: { input_tokens: 100, output_tokens: 200 },
      };
    });

    const { runCEOAgent } = await import("../src/orchestrator/ceo-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const plan = await runCEOAgent({
      idea: "Cycle failure test",
      apiKey: "test-key",
      baseURL: "https://test.example.com",
      outputBase: TEST_OUTPUT_BASE,
      logger,
      projectRoot: join(__dirname, ".."),
      enableApproval: false,
      linearApiKey: "lin_api_test_key",
    });

    expect(["complete", "partial"]).toContain(plan.status);
    expect(plan.linearSync).toBeDefined();
    expect(plan.linearSync!.errors.some((e) => e.includes("cycle") || e.includes("Cycle"))).toBe(true);
  });
});
