import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createVersionStore } from "../src/meta-loop/version-store.js";
import type { ProposedChange } from "../src/types/meta-types.js";

let testDir: string;
let projectDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `meta-version-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  projectDir = join(testDir, "project");
  await mkdir(testDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function makeProposal(overrides: Partial<ProposedChange> = {}): ProposedChange {
  return {
    proposalId: "test-prop-001",
    createdAt: new Date().toISOString(),
    sourceFile: "src/prompts/agent-prompts.ts",
    patch: JSON.stringify({ oldText: "old", newText: "new" }),
    beforeHash: "hash1",
    afterHash: "hash2",
    category: "prompt",
    ruleId: "rule_test",
    confidence: 0.9,
    signals: ["signal1"],
    status: "pending",
    provenance: { runId: "run-1", ruleId: "rule_test" },
    ...overrides,
  };
}

describe("version-store", () => {
  describe("writeProposal + readPending", () => {
    it("writes a proposal to disk", async () => {
      const store = createVersionStore(testDir, projectDir);
      const proposal = makeProposal();
      await store.writeProposal(proposal);

      const dateDir = new Date().toISOString().slice(0, 10);
      const filePath = join(testDir, ".meta", "proposals", dateDir, `${proposal.proposalId}.json`);
      const raw = await readFile(filePath, "utf-8");
      expect(JSON.parse(raw).proposalId).toBe("test-prop-001");
    });

    it("appends to pending list", async () => {
      const store = createVersionStore(testDir, projectDir);
      await store.writeProposal(makeProposal({ proposalId: "p1" }));
      await store.writeProposal(makeProposal({ proposalId: "p2" }));

      const pending = await store.readPending();
      expect(pending).toHaveLength(2);
    });
  });

  describe("updateStatus", () => {
    it("updates proposal status", async () => {
      const store = createVersionStore(testDir, projectDir);
      await store.writeProposal(makeProposal({ proposalId: "p1" }));
      await store.updateStatus("p1", "applied", { appliedAt: "2026-01-01T00:00:00Z" });

      const pending = await store.readPending();
      expect(pending[0].status).toBe("applied");
      expect(pending[0].appliedAt).toBe("2026-01-01T00:00:00Z");
    });
  });

  describe("applyProposal", () => {
    it("rejects apply when hash mismatches", async () => {
      const srcDir = join(projectDir, "src", "prompts");
      await mkdir(srcDir, { recursive: true });
      const srcFile = join(srcDir, "agent-prompts.ts");
      await writeFile(srcFile, "# Role\nold content here\n## Output Rules\nfixed");

      const store = createVersionStore(testDir, projectDir);
      const proposal = makeProposal({
        sourceFile: "src/prompts/agent-prompts.ts",
        patch: JSON.stringify({ oldText: "old content here", newText: "new content here" }),
        beforeHash: "definitely-wrong-hash",
      });

      const failResult = await store.applyProposal(proposal, projectDir);
      expect(failResult.success).toBe(false);
      expect(failResult.error).toContain("Hash mismatch");
    });

    it("applies a replace patch to a file", async () => {
      const srcDir = join(projectDir, "src", "prompts");
      await mkdir(srcDir, { recursive: true });
      const srcFile = join(srcDir, "agent-prompts.ts");
      const originalContent = "# Role\nold content here\n## Output Rules\nfixed";
      await writeFile(srcFile, originalContent);

      // Compute hash the same way applyProposal will.
      const crypto = await import("node:crypto");
      const fileContent = await readFile(srcFile, "utf-8");
      const correctHash = crypto.createHash("sha256").update(fileContent).digest("hex");

      const store = createVersionStore(testDir, projectDir);
      const proposal = makeProposal({
        sourceFile: "src/prompts/agent-prompts.ts",
        patch: JSON.stringify({ oldText: "old content here", newText: "new content here" }),
        beforeHash: correctHash,
      });

      const successResult = await store.applyProposal(proposal, projectDir);
      expect(successResult.success).toBe(true);

      const newContent = await readFile(srcFile, "utf-8");
      expect(newContent).toContain("new content here");
      expect(newContent).not.toContain("old content here");
    });
  });

  describe("rollbackProposal", () => {
    it("restores file from before-snapshot", async () => {
      const srcDir = join(projectDir, "src", "prompts");
      await mkdir(srcDir, { recursive: true });
      const srcFile = join(srcDir, "agent-prompts.ts");
      const originalContent = "original content";
      await writeFile(srcFile, originalContent);

      const store = createVersionStore(testDir, projectDir);
      const crypto = await import("node:crypto");
      const fileContent = await readFile(srcFile, "utf-8");
      const correctHash = crypto.createHash("sha256").update(fileContent).digest("hex");

      const proposal = makeProposal({
        sourceFile: "src/prompts/agent-prompts.ts",
        patch: JSON.stringify({ oldText: "original content", newText: "modified content" }),
        beforeHash: correctHash,
        proposalId: "rollback-test-001",
      });

      // Apply.
      await store.applyProposal(proposal, projectDir);
      expect(await readFile(srcFile, "utf-8")).toBe("modified content");

      // Rollback.
      const result = await store.rollbackProposal("rollback-test-001", "src/prompts/agent-prompts.ts", projectDir);
      expect(result.success).toBe(true);
      expect(await readFile(srcFile, "utf-8")).toBe("original content");
    });
  });
});

