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

const TEST_OUTPUT_BASE = join(__dirname, "..", "outputs-test-base");

describe("Base Agent — capOutput", () => {
  it("should not truncate output under the byte limit", async () => {
    const { capOutput } = await import("../src/agents/base-agent.js");
    const text = "Hello, world!";
    expect(capOutput(text, 1024)).toBe(text);
  });

  it("should truncate output exceeding the byte limit", async () => {
    const { capOutput } = await import("../src/agents/base-agent.js");
    const text = "x".repeat(2000);
    const result = capOutput(text, 1024);
    expect(result.length).toBeLessThan(text.length);
    expect(result).toContain("[OUTPUT TRUNCATED");
  });

  it("should handle multi-byte UTF-8 characters correctly", async () => {
    const { capOutput } = await import("../src/agents/base-agent.js");
    // Each emoji is 4 bytes in UTF-8
    const emojis = "😀".repeat(300); // 1200 bytes
    const result = capOutput(emojis, 500);
    // Should not exceed 500 bytes
    const byteLength = Buffer.byteLength(result.replace(/\n\n---\n\[OUTPUT TRUNCATED: output exceeded 500 byte limit\]/, ""), "utf-8");
    expect(byteLength).toBeLessThanOrEqual(500);
  });

  it("should handle empty string", async () => {
    const { capOutput } = await import("../src/agents/base-agent.js");
    expect(capOutput("", 1024)).toBe("");
  });

  it("should handle exact byte limit boundary", async () => {
    const { capOutput } = await import("../src/agents/base-agent.js");
    const text = "a".repeat(1024);
    // Exactly at limit — should not truncate
    expect(capOutput(text, 1024)).toBe(text);
  });

  it("should truncate at 1 byte over limit", async () => {
    const { capOutput } = await import("../src/agents/base-agent.js");
    const text = "a".repeat(1025);
    const result = capOutput(text, 1024);
    expect(result).toContain("[OUTPUT TRUNCATED");
  });
});

describe("Base Agent — extractJsonBlock", () => {
  it("should extract JSON from fenced code block", async () => {
    const { extractJsonBlock } = await import("../src/agents/base-agent.js");
    const text = 'Some text\n```json\n{"key": "value", "num": 42}\n```\nMore text';
    const result = extractJsonBlock(text);
    expect(result).toEqual({ key: "value", num: 42 });
  });

  it("should return null when no JSON block exists", async () => {
    const { extractJsonBlock } = await import("../src/agents/base-agent.js");
    expect(extractJsonBlock("No code blocks here")).toBeNull();
  });

  it("should return null for invalid JSON in code block", async () => {
    const { extractJsonBlock } = await import("../src/agents/base-agent.js");
    expect(extractJsonBlock("```json\nnot valid json\n```")).toBeNull();
  });

  it("should handle empty JSON object", async () => {
    const { extractJsonBlock } = await import("../src/agents/base-agent.js");
    expect(extractJsonBlock("```json\n{}\n```")).toEqual({});
  });
});

describe("Base Agent — classifyError", () => {
  // classifyError is not exported, but we test it indirectly through runAgentWithRetry behavior
  // We can test the error classification by observing retry behavior

  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("should classify timeout errors", async () => {
    // We test this by verifying that timeout errors trigger retry
    let callCount = 0;
    mockCreate.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Request ETIMEDOUT");
      }
      return {
        content: [{ type: "text" as const, text: "Success" }],
        usage: { input_tokens: 10, output_tokens: 20 },
      };
    });

    const { runAgentWithRetry } = await import("../src/agents/base-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const result = await runAgentWithRetry(
      {
        id: "test-timeout",
        role: "pm",
        task: "Test",
        context: "",
        outputPath: join(TEST_OUTPUT_BASE, "pm"),
      },
      {
        apiKey: "test",
        baseURL: "https://test.example.com",
        outputBase: TEST_OUTPUT_BASE,
        logger,
        parentRole: "ceo",
        readArtifact: async () => null,
        projectRoot: join(__dirname, ".."),
        enableWebTools: false,
        resultsRegistry: { publish: () => {}, get: () => undefined, getSummary: () => "", has: () => false, getAll: () => new Map(), entries: () => [][Symbol.iterator](), clear: () => {} } as any,
        messageBus: { subscribe: () => () => {}, send: () => {} } as any,
      },
      1,
    );

    // Should have retried and succeeded
    expect(result.status).toBe("completed");
    expect(callCount).toBe(2);
  });

  it("should NOT retry on auth errors", async () => {
    let callCount = 0;
    mockCreate.mockImplementation(() => {
      callCount++;
      throw new Error("401 Unauthorized");
    });

    const { runAgentWithRetry } = await import("../src/agents/base-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const result = await runAgentWithRetry(
      {
        id: "test-auth",
        role: "pm",
        task: "Test",
        context: "",
        outputPath: join(TEST_OUTPUT_BASE, "pm"),
      },
      {
        apiKey: "test",
        baseURL: "https://test.example.com",
        outputBase: TEST_OUTPUT_BASE,
        logger,
        parentRole: "ceo",
        readArtifact: async () => null,
        projectRoot: join(__dirname, ".."),
        enableWebTools: false,
        resultsRegistry: { publish: () => {}, get: () => undefined, getSummary: () => "", has: () => false, getAll: () => new Map(), entries: () => [][Symbol.iterator](), clear: () => {} } as any,
        messageBus: { subscribe: () => () => {}, send: () => {} } as any,
      },
      1,
    );

    // Should NOT have retried — auth errors are non-retryable
    expect(result.status).toBe("failed");
    expect(callCount).toBe(1);
  });

  it("should retry on rate limit errors", async () => {
    let callCount = 0;
    mockCreate.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        throw new Error("429 Too Many Requests");
      }
      return {
        content: [{ type: "text" as const, text: "Success" }],
        usage: { input_tokens: 10, output_tokens: 20 },
      };
    });

    const { runAgentWithRetry } = await import("../src/agents/base-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const result = await runAgentWithRetry(
      {
        id: "test-rate",
        role: "pm",
        task: "Test",
        context: "",
        outputPath: join(TEST_OUTPUT_BASE, "pm"),
      },
      {
        apiKey: "test",
        baseURL: "https://test.example.com",
        outputBase: TEST_OUTPUT_BASE,
        logger,
        parentRole: "ceo",
        readArtifact: async () => null,
        projectRoot: join(__dirname, ".."),
        enableWebTools: false,
        resultsRegistry: { publish: () => {}, get: () => undefined, getSummary: () => "", has: () => false, getAll: () => new Map(), entries: () => [][Symbol.iterator](), clear: () => {} } as any,
        messageBus: { subscribe: () => () => {}, send: () => {} } as any,
      },
      1,
    );

    expect(result.status).toBe("completed");
    expect(callCount).toBe(2);
  }, 15000);

  it("should retry on server errors (500/502/503)", async () => {
    let callCount = 0;
    mockCreate.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        throw new Error("502 Bad Gateway");
      }
      return {
        content: [{ type: "text" as const, text: "Success" }],
        usage: { input_tokens: 10, output_tokens: 20 },
      };
    });

    const { runAgentWithRetry } = await import("../src/agents/base-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const result = await runAgentWithRetry(
      {
        id: "test-server",
        role: "pm",
        task: "Test",
        context: "",
        outputPath: join(TEST_OUTPUT_BASE, "pm"),
      },
      {
        apiKey: "test",
        baseURL: "https://test.example.com",
        outputBase: TEST_OUTPUT_BASE,
        logger,
        parentRole: "ceo",
        readArtifact: async () => null,
        projectRoot: join(__dirname, ".."),
        enableWebTools: false,
        resultsRegistry: { publish: () => {}, get: () => undefined, getSummary: () => "", has: () => false, getAll: () => new Map(), entries: () => [][Symbol.iterator](), clear: () => {} } as any,
        messageBus: { subscribe: () => () => {}, send: () => {} } as any,
      },
      1,
    );

    expect(result.status).toBe("completed");
    expect(callCount).toBe(2);
  });

  it("should not retry when maxRetries is 0", async () => {
    let callCount = 0;
    mockCreate.mockImplementation(() => {
      callCount++;
      throw new Error("500 Internal Server Error");
    });

    const { runAgentWithRetry } = await import("../src/agents/base-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    const result = await runAgentWithRetry(
      {
        id: "test-no-retry",
        role: "pm",
        task: "Test",
        context: "",
        outputPath: join(TEST_OUTPUT_BASE, "pm"),
      },
      {
        apiKey: "test",
        baseURL: "https://test.example.com",
        outputBase: TEST_OUTPUT_BASE,
        logger,
        parentRole: "ceo",
        readArtifact: async () => null,
        projectRoot: join(__dirname, ".."),
        enableWebTools: false,
        resultsRegistry: { publish: () => {}, get: () => undefined, getSummary: () => "", has: () => false, getAll: () => new Map(), entries: () => [][Symbol.iterator](), clear: () => {} } as any,
        messageBus: { subscribe: () => () => {}, send: () => {} } as any,
      },
      0,
    );

    expect(result.status).toBe("failed");
    expect(callCount).toBe(1);
  });

  it("should include previous error in retry context", async () => {
    let receivedContext = "";
    let callCount = 0;
    mockCreate.mockImplementation((params: any) => {
      callCount++;
      const msg = params.messages?.[0]?.content ?? "";
      if (msg.includes("Previous Attempt Error")) {
        receivedContext = msg;
      }
      if (callCount === 1) {
        throw new Error("500 Internal Server Error");
      }
      return {
        content: [{ type: "text" as const, text: "Success" }],
        usage: { input_tokens: 10, output_tokens: 20 },
      };
    });

    const { runAgentWithRetry } = await import("../src/agents/base-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    await runAgentWithRetry(
      {
        id: "test-prev-error",
        role: "pm",
        task: "Test",
        context: "",
        outputPath: join(TEST_OUTPUT_BASE, "pm"),
      },
      {
        apiKey: "test",
        baseURL: "https://test.example.com",
        outputBase: TEST_OUTPUT_BASE,
        logger,
        parentRole: "ceo",
        readArtifact: async () => null,
        projectRoot: join(__dirname, ".."),
        enableWebTools: false,
        resultsRegistry: { publish: () => {}, get: () => undefined, getSummary: () => "", has: () => false, getAll: () => new Map(), entries: () => [][Symbol.iterator](), clear: () => {} } as any,
        messageBus: { subscribe: () => () => {}, send: () => {} } as any,
      },
      1,
    );

    expect(receivedContext).toContain("Previous Attempt Error");
  });
});

describe("Base Agent — runAgent output capping", () => {
  beforeEach(() => {
    rmSync(TEST_OUTPUT_BASE, { recursive: true, force: true });
    mkdirSync(TEST_OUTPUT_BASE, { recursive: true });
    mockCreate.mockReset();
  });

  afterEach(() => {
    rmSync(TEST_OUTPUT_BASE, { recursive: true, force: true });
  });

  it("should cap output at 512KB when agent produces oversized output", async () => {
    const hugeOutput = "x".repeat(600_000); // ~600KB
    mockCreate.mockResolvedValue({
      content: [{ type: "text" as const, text: hugeOutput }],
      usage: { input_tokens: 100, output_tokens: 200 },
    });

    const { runAgentWithRetry } = await import("../src/agents/base-agent.js");
    const { AgentLogger } = await import("../src/observability/logger.js");

    const logger = new AgentLogger();
    await runAgentWithRetry(
      {
        id: "test-cap",
        role: "pm",
        task: "Test",
        context: "",
        outputPath: join(TEST_OUTPUT_BASE, "pm"),
      },
      {
        apiKey: "test",
        baseURL: "https://test.example.com",
        outputBase: TEST_OUTPUT_BASE,
        logger,
        parentRole: "ceo",
        readArtifact: async () => null,
        projectRoot: join(__dirname, ".."),
        enableWebTools: false,
        resultsRegistry: { publish: () => {}, get: () => undefined, getSummary: () => "", has: () => false, getAll: () => new Map(), entries: () => [][Symbol.iterator](), clear: () => {} } as any,
        messageBus: { subscribe: () => () => {}, send: () => {} } as any,
      },
      0,
    );

    const outputFile = join(TEST_OUTPUT_BASE, "pm", "output.md");
    expect(existsSync(outputFile)).toBe(true);
    const written = readFileSync(outputFile, "utf-8");
    expect(written).toContain("[OUTPUT TRUNCATED");
    // The written file should be at most ~512KB + the truncation notice
    expect(Buffer.byteLength(written, "utf-8")).toBeLessThanOrEqual(512 * 1024 + 100);
  });
});
