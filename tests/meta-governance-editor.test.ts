import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { applyGovernanceEdit } from "../src/meta-loop/governance-editor.js";
import type { ProposedChange } from "../src/types/meta-types.js";

let testDir: string;
let projectDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `meta-gov-editor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
    sourceFile: "src/governance/policy-templates.ts",
    patch: JSON.stringify({}),
    beforeHash: "hash1",
    afterHash: "hash2",
    category: "governance",
    ruleId: "rule_test",
    confidence: 0.9,
    signals: ["signal1"],
    status: "pending",
    provenance: { runId: "run-1", ruleId: "rule_test" },
    ...overrides,
  };
}

describe("governance-editor", () => {
  describe("applyGovernanceEdit", () => {
    it("tunes a policy rule condition level", async () => {
      const srcDir = join(projectDir, "src", "governance");
      await mkdir(srcDir, { recursive: true });
      const srcFile = join(srcDir, "policy-templates.ts");
      const content = `
const rules: PolicyRule[] = [
  {
    id: "rule-external-api",
    name: "External API Call",
    effect: "require_approval",
    subjects: ["*"],
    actions: ["external_api_call"],
    conditions: [
      { type: "risk_threshold", params: { level: "high" } }
    ],
    priority: 10,
  },
];
`;
      await writeFile(srcFile, content);

      const proposal = makeProposal({
        sourceFile: "src/governance/policy-templates.ts",
        patch: JSON.stringify({
          strategy: "policy-rule",
          ruleId: "rule-external-api",
          conditionType: "risk_threshold",
          fromLevel: "high",
          toLevel: "medium",
        }),
      });

      const result = await applyGovernanceEdit(proposal, projectDir);
      expect(result.success).toBe(true);

      const newContent = await readFile(srcFile, "utf-8");
      expect(newContent).toContain('"level": "medium"');
      expect(newContent).not.toContain('"level": "high"');
    });

    it("tunes approval matrix minApprovals", async () => {
      const srcDir = join(projectDir, "src", "governance");
      await mkdir(srcDir, { recursive: true });
      const srcFile = join(srcDir, "policy-templates.ts");
      const content = `
const matrix: ApprovalMatrix = {
  critical: { approvers: ["ceo", "ciso"], minApprovals: 2 },
  high: { approvers: ["ceo"], minApprovals: 1 },
  medium: { approvers: ["cto"], minApprovals: 1 },
  low: { approvers: ["pm"], minApprovals: 1 },
};
`;
      await writeFile(srcFile, content);

      const proposal = makeProposal({
        sourceFile: "src/governance/policy-templates.ts",
        patch: JSON.stringify({
          strategy: "approval-matrix",
          riskLevel: "critical",
          fromApprovals: 2,
          toApprovals: 3,
        }),
      });

      const result = await applyGovernanceEdit(proposal, projectDir);
      expect(result.success).toBe(true);

      const newContent = await readFile(srcFile, "utf-8");
      expect(newContent).toContain("minApprovals: 3");
      expect(newContent).not.toContain("minApprovals: 2");
    });

    it('returns error for unknown rule id', async () => {
      const srcDir = join(projectDir, "src", "governance");
      await mkdir(srcDir, { recursive: true });
      const srcFile = join(srcDir, "policy-templates.ts");
      await writeFile(srcFile, "// empty file");

      const proposal = makeProposal({
        sourceFile: "src/governance/policy-templates.ts",
        patch: JSON.stringify({
          strategy: "policy-rule",
          ruleId: "nonexistent-rule",
          conditionType: "risk_threshold",
          fromLevel: "high",
          toLevel: "medium",
        }),
      });

      const result = await applyGovernanceEdit(proposal, projectDir);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("returns error for invalid patch format", async () => {
      const proposal = makeProposal({
        patch: "invalid json",
      });

      const result = await applyGovernanceEdit(proposal, projectDir);
      expect(result.success).toBe(false);
    });
  });
});
