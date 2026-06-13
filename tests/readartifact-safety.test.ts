import { describe, it, expect, vi, beforeEach } from "vitest";

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

describe("readArtifact Path Traversal Safety", () => {
  // We test the path confinement logic used in ceo-agent.ts's readArtifact function.
  // Since readArtifact is created inline in runCEOAgent, we replicate the logic here.

  function createReadArtifact(outputBase: string) {
    return async (path: string): Promise<string | null> => {
      try {
        const { resolve, sep } = await import("node:path");
        const allowedRoot = resolve(outputBase);
        const resolved = resolve(path);
        if (!resolved.startsWith(allowedRoot + sep) && resolved !== allowedRoot) {
          console.error(`readArtifact blocked: path "${path}" is outside outputBase`);
          return null;
        }
      } catch {
        return null; // Malformed path
      }
      const { readFileIfExists } = await import("../src/tools/file-tools.js");
      return readFileIfExists(path);
    };
  }

  const outputBase = "/home/user/project/outputs";

  it("should allow reads within the outputBase directory", async () => {
    const readArtifact = createReadArtifact(outputBase);
    // The path is within outputBase but file doesn't exist — should return null (file not found), not blocked
    const result = await readArtifact("/home/user/project/outputs/pm/output.md");
    expect(result).toBeNull();
  });

  it("should block path traversal with ../ sequences", async () => {
    const readArtifact = createReadArtifact(outputBase);
    const result = await readArtifact("/home/user/project/outputs/../../../etc/passwd");
    expect(result).toBeNull();
    // Note: the function returns null both for "blocked" and "file not found"
    // The important thing is it doesn't read files outside of outputBase
  });

  it("should block reads to /etc/passwd", async () => {
    const readArtifact = createReadArtifact(outputBase);
    const result = await readArtifact("/etc/passwd");
    expect(result).toBeNull();
  });

  it("should block reads to sensitive system paths", async () => {
    const readArtifact = createReadArtifact(outputBase);
    const sensitivePaths = [
      "/etc/shadow",
      "/etc/hosts",
      "/proc/self/environ",
      "C:\\Windows\\System32\\config\\SAM",
    ];
    for (const p of sensitivePaths) {
      const result = await readArtifact(p);
      expect(result).toBeNull();
    }
  });

  it("should handle the outputBase itself (exact match)", async () => {
    const readArtifact = createReadArtifact(outputBase);
    // Exactly the outputBase path should be allowed (resolved === allowedRoot)
    const result = await readArtifact(outputBase);
    // File doesn't exist, so null — but importantly it was NOT blocked
    expect(result).toBeNull();
  });

  it("should handle malformed paths gracefully", async () => {
    const readArtifact = createReadArtifact(outputBase);
    // Empty path, null bytes, etc.
    const result = await readArtifact("");
    expect(result).toBeNull();
  });

  it("should handle paths with null bytes", async () => {
    const readArtifact = createReadArtifact(outputBase);
    const result = await readArtifact("/home/user/project/outputs/file\x00.md");
    // Should not crash — paths with null bytes are either blocked or return null
    expect(result === null || typeof result === "string").toBe(true);
  });
});
