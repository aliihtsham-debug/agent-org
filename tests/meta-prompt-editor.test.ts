import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { applyPromptEdit } from "../src/meta-loop/prompt-editor.js";
import type { ProposedChange } from "../src/types/meta-types.js";

let testDir: string;
let projectDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `meta-prompt-editor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe("prompt-editor", () => {
  describe("applyPromptEdit", () => {
    it("applies a simple find/replace patch", async () => {
      const srcDir = join(projectDir, "src", "prompts");
      await mkdir(srcDir, { recursive: true });
      const srcFile = join(srcDir, "agent-prompts.ts");
      const content = "# Role\nold content here\n## Output Rules\nfixed";
      await writeFile(srcFile, content);

      const proposal = makeProposal({
        sourceFile: "src/prompts/agent-prompts.ts",
        patch: JSON.stringify({ oldText: "old content here", newText: "new content here" }),
      });

      const result = await applyPromptEdit(proposal, projectDir);
      expect(result.success).toBe(true);

      const newContent = await readFile(srcFile, "utf-8");
      expect(newContent).toContain("new content here");
      expect(newContent).not.toContain("old content here");
    });

    it("rejects edit when oldText not found", async () => {
      const srcDir = join(projectDir, "src", "prompts");
      await mkdir(srcDir, { recursive: true });
      const srcFile = join(srcDir, "agent-prompts.ts");
      await writeFile(srcFile, "completely different content");

      const proposal = makeProposal({
        sourceFile: "src/prompts/agent-prompts.ts",
        patch: JSON.stringify({ oldText: "not present", newText: "replacement" }),
      });

      const result = await applyPromptEdit(proposal, projectDir);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("rejects edit with invalid patch format", async () => {
      const srcDir = join(projectDir, "src", "prompts");
      await mkdir(srcDir, { recursive: true });
      const srcFile = join(srcDir, "agent-prompts.ts");
      await writeFile(srcFile, "some content");

      const proposal = makeProposal({
        sourceFile: "src/prompts/agent-prompts.ts",
        patch: "not valid json",
      });

      const result = await applyPromptEdit(proposal, projectDir);
      expect(result.success).toBe(false);
    });

    it("preserves unrelated content", async () => {
      const srcDir = join(projectDir, "src", "prompts");
      await mkdir(srcDir, { recursive: true });
      const srcFile = join(srcDir, "agent-prompts.ts");
      const content = "line one\ntarget line\nline three\n";
      await writeFile(srcFile, content);

      const proposal = makeProposal({
        sourceFile: "src/prompts/agent-prompts.ts",
        patch: JSON.stringify({ oldText: "target line", newText: "replaced line" }),
      });

      const result = await applyPromptEdit(proposal, projectDir);
      expect(result.success).toBe(true);

      const newContent = await readFile(srcFile, "utf-8");
      expect(newContent).toContain("line one");
      expect(newContent).toContain("replaced line");
      expect(newContent).toContain("line three");
    });

    it("handles multiple occurrences of oldText (single replacement)", async () => {
      const srcDir = join(projectDir, "src", "prompts");
      await mkdir(srcDir, { recursive: true });
      const srcFile = join(srcDir, "agent-prompts.ts");
      const content = "repeat\nrepeat\nrepeat";
      await writeFile(srcFile, content);

      const proposal = makeProposal({
        sourceFile: "src/prompts/agent-prompts.ts",
        patch: JSON.stringify({ oldText: "repeat", newText: "once" }),
      });

      const result = await applyPromptEdit(proposal, projectDir);
      expect(result.success).toBe(true);

      const newContent = await readFile(srcFile, "utf-8");
      // String.replace replaces first occurrence only.
      expect(newContent).toBe("once\nrepeat\nrepeat");
    });

    it("returns error for non-existent file", async () => {
      const proposal = makeProposal({
        sourceFile: "src/nonexistent/file.ts",
        patch: JSON.stringify({ oldText: "x", newText: "y" }),
      });

      const result = await applyPromptEdit(proposal, projectDir);
      expect(result.success).toBe(false);
    });
  });
});
