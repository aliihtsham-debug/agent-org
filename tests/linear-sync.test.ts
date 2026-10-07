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

const TEST_OUTPUT_BASE = join(__dirname, "..", "outputs-test-linear");

describe("Linear Sync", () => {
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

  function mockMapperResponse() {
    return {
      content: [
        {
          type: "text" as const,
          text: `# Linear Import

\`\`\`json
{
  "projectName": "Test product",
  "projectDescription": "A test product",
  "labels": ["pm", "cto", "security"],
  "cycles": [
    {
      "name": "Sprint 1: Foundation",
      "startsAt": "2026-06-14T00:00:00.000Z",
      "endsAt": "2026-06-28T00:00:00.000Z"
    }
  ],
  "issues": [
    {
      "title": "Setup project structure",
      "description": "Initialize the project with core architecture",
      "labels": ["cto", "engineering"],
      "priority": "high",
      "cycleName": "Sprint 1: Foundation"
    },
    {
      "title": "Implement auth",
      "description": "Add authentication system",
      "labels": ["security", "backend-engineer"],
      "priority": "urgent",
      "cycleName": "Sprint 1: Foundation"
    }
  ],
  "metadata": {
    "agentCount": 26,
    "tokenUsage": { "input": 50000, "output": 20000 },
    "durationMs": 15000,
    "timestamp": "2026-06-14T00:00:00.000Z",
    "icSummaries": []
  }
}
\`\`\``,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 200 },
    };
  }

  function mockSimpleMapperResponse() {
    return {
      content: [
        {
          type: "text" as const,
          text: `# Linear Import\n\n\`\`\`json\n{"projectName": "Test product", "projectDescription": "Test", "labels": ["pm"], "cycles": [], "issues": [{"title": "Issue 1", "description": "Desc", "labels": ["pm"], "priority": "high"}], "metadata": {"agentCount": 26, "tokenUsage": {"input": 100, "output": 200}, "durationMs": 1000, "timestamp": "2026-06-14T00:00:00.000Z", "icSummaries": []}}\n\`\`\``,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 200 },
    };
  }

  it("should skip sync when no API key is provided", async () => {
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

    expect(plan.linearSync).toBeUndefined();
  });

  it("should create project, labels, cycles, and issues when API key is set", async () => {
    // Setup mock responses for Linear SDK
    mockTeams.mockResolvedValue({
      nodes: [{ id: "team-1", name: "Engineering" }],
    });
    mockProjects.mockResolvedValue({ nodes: [] });
    mockCreateProject.mockResolvedValue({
      get project() {
        return Promise.resolve({
          id: "proj-1",
          url: "https://linear.app/test/project/proj-1",
        });
      },
    });
    mockCreateIssueLabel.mockResolvedValue({
      get issueLabel() {
        return Promise.resolve({ id: "label-1" });
      },
    });
    mockCreateCycle.mockResolvedValue({
      get cycle() {
        return Promise.resolve({
          id: "cycle-1",
          number: 1,
          url: "https://linear.app/test/cycle/cycle-1",
        });
      },
    });
    mockCreateIssue.mockResolvedValue({
      get issue() {
        return Promise.resolve({
          id: "issue-1",
          url: "https://linear.app/test/issue/issue-1",
        });
      },
    });

    // Agent responses: return mapper JSON for all calls so every agent succeeds
    // Regular agents will use default summary/artifacts; mapper extracts its JSON
    mockCreate.mockResolvedValue(mockMapperResponse());

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
      linearApiKey: "lin_api_test_key",
    });

    // Verify linear sync result
    expect(plan.linearSync).toBeDefined();
    expect(plan.linearSync!.projectUrl).toBe("https://linear.app/test/project/proj-1");
    expect(plan.linearSync!.labelIds.length).toBeGreaterThan(0);
    expect(plan.linearSync!.cycleUrls.length).toBeGreaterThan(0);
    expect(plan.linearSync!.issueUrls.length).toBeGreaterThan(0);
    expect(plan.linearSync!.created).toBeGreaterThan(0);
  });

  it("should handle Linear API errors gracefully", async () => {
    mockTeams.mockRejectedValue(new Error("Invalid API key"));

    // Agent responses: return mapper JSON for all calls so every agent succeeds
    mockCreate.mockResolvedValue(mockSimpleMapperResponse());

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
      linearApiKey: "invalid_key",
    });

    // Should still complete successfully — Linear sync is non-fatal
    expect(["complete", "partial"]).toContain(plan.status);
    // Linear sync result should have errors
    expect(plan.linearSync).toBeDefined();
    expect(plan.linearSync!.errors.length).toBeGreaterThan(0);
  });

  it("should reuse existing project on re-run", async () => {
    mockTeams.mockResolvedValue({
      nodes: [{ id: "team-1", name: "Engineering" }],
    });
    // Project already exists
    mockProjects.mockResolvedValue({
      nodes: [{ id: "existing-proj", name: "Test product", url: "https://linear.app/test/existing" }],
    });
    mockCreateIssueLabel.mockResolvedValue({
      get issueLabel() {
        return Promise.resolve({ id: "label-1" });
      },
    });
    mockCreateCycle.mockResolvedValue({
      get cycle() {
        return Promise.resolve({
          id: "cycle-1",
          number: 1,
          url: "https://linear.app/test/cycle/cycle-1",
        });
      },
    });
    mockCreateIssue.mockResolvedValue({
      get issue() {
        return Promise.resolve({
          id: "issue-1",
          url: "https://linear.app/test/issue/issue-1",
        });
      },
    });

    // Agent responses: return mapper JSON for all calls so every agent succeeds
    mockCreate.mockResolvedValue(mockSimpleMapperResponse());

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
      linearApiKey: "lin_api_test_key",
    });

    expect(plan.linearSync).toBeDefined();
    // Should reuse existing project URL
    expect(plan.linearSync!.projectUrl).toBe("https://linear.app/test/existing");
    expect(plan.linearSync!.created).toBeGreaterThan(0);
  });
});