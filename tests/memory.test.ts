/**
 * Phase 12 — Multi-Agent Operating System Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { loadMemory, saveMemory, addEntry, retrieveRelevant, compressSummary } from "../src/memory/agent-memory.js";
import { recordEvent, calculateScore, getTopAgents } from "../src/memory/reputation-tracker.js";
import { addKnowledge, search } from "../src/memory/org-knowledge.js";
import { saveCheckpoint, loadCheckpoint, listWorkflows } from "../src/memory/workflow-state.js";
import type { AgentMemory, MemoryEntry } from "../src/types/memory-types.js";

const TEST_MEMORY_DIR = `outputs/.memory-test-${Date.now()}`;

describe("Phase 12 — Multi-Agent Operating System", () => {
  beforeEach(async () => {
    process.env.AGENT_ORG_MEMORY_DIR = TEST_MEMORY_DIR;
    process.env.AGENT_ORG_WORKFLOW_DIR = TEST_MEMORY_DIR;
    await rm(TEST_MEMORY_DIR, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_MEMORY_DIR, { recursive: true });
  });

  afterEach(async () => {
    delete process.env.AGENT_ORG_MEMORY_DIR;
    delete process.env.AGENT_ORG_WORKFLOW_DIR;
    await rm(TEST_MEMORY_DIR, { recursive: true, force: true }).catch(() => {});
  });

  describe("Agent Memory", () => {
    it("1. memory save/load roundtrip", async () => {
      const memory: AgentMemory = {
        agentId: "test-agent",
        agentDid: "did:agent:test-agent",
        entries: [
          {
            timestamp: new Date().toISOString(),
            projectId: "project-1",
            type: "lesson",
            content: "Always validate inputs before processing",
            importance: 0.9,
            tags: ["security", "validation"],
          },
        ],
        summary: "test summary",
        lastUpdated: new Date().toISOString(),
        version: 1,
      };

      await saveMemory(memory);
      const loaded = await loadMemory("test-agent");
      expect(loaded.agentId).toBe("test-agent");
      expect(loaded.entries.length).toBe(1);
      expect(loaded.entries[0].content).toBe("Always validate inputs before processing");
    });

    it("2. memory entry addition and retrieval", async () => {
      await addEntry("entry-test", {
        timestamp: new Date().toISOString(),
        projectId: "p1",
        type: "pattern",
        content: "Use dependency injection for better testability",
        importance: 0.8,
        tags: ["architecture", "testing"],
      });

      const memory = await loadMemory("entry-test");
      expect(memory.entries.length).toBe(1);
      expect(memory.entries[0].type).toBe("pattern");
    });

    it("3. relevance-based retrieval", async () => {
      const agentId = "relevance-test";
      await addEntry(agentId, {
        timestamp: new Date().toISOString(),
        projectId: "p1",
        type: "lesson",
        content: "React components should be small and focused",
        importance: 0.9,
        tags: ["react", "frontend"],
      });
      await addEntry(agentId, {
        timestamp: new Date().toISOString(),
        projectId: "p1",
        type: "pattern",
        content: "Database queries should use parameterized statements",
        importance: 0.7,
        tags: ["database", "security"],
      });

      const relevant = await retrieveRelevant(agentId, "React frontend components", 5);
      expect(relevant.length).toBeGreaterThan(0);
      // The React entry should be ranked higher
      expect(relevant[0].content).toContain("React");
    });

    it("4. memory summary compression", async () => {
      const agentId = "compress-test";
      for (let i = 0; i < 5; i++) {
        await addEntry(agentId, {
          timestamp: new Date().toISOString(),
          projectId: `p${i}`,
          type: "lesson",
          content: `Lesson number ${i}: Always test your code thoroughly before deploying`,
          importance: 0.5 + i * 0.1,
          tags: ["testing"],
        });
      }

      const summary = await compressSummary(agentId, 2000);
      expect(summary.length).toBeGreaterThan(0);
      expect(summary.length).toBeLessThanOrEqual(2000);
    });

    it("5. reputation score calculation after events", async () => {
      const agentId = "ceo";
      await recordEvent(agentId, {
        timestamp: new Date().toISOString(),
        projectId: "p1",
        event: "completion",
        delta: 5,
        details: "Completed successfully",
      });

      const score = await calculateScore(agentId);
      expect(score.agentId).toBe("ceo");
      expect(score.overall).toBeGreaterThanOrEqual(0);
      expect(score.overall).toBeLessThanOrEqual(100);
    });

    it("6. reputation tracking with refinement integration", async () => {
      await recordEvent("security-auditor", {
        timestamp: new Date().toISOString(),
        projectId: "p1",
        event: "critique_accepted",
        delta: 3,
        details: "Security review accepted",
      });

      const score = await calculateScore("security-auditor");
      expect(score.quality).toBeGreaterThan(50); // Base is 50, +3 for accepted critique
    });

    it("7. organizational knowledge search", async () => {
      await addKnowledge({
        projectId: "p1",
        type: "pattern",
        content: "Use microservices for scalable applications",
        relevance: ["architecture", "scalability", "microservices"],
        sourceAgents: ["cto"],
      });
      await addKnowledge({
        projectId: "p2",
        type: "lesson",
        content: "Always use HTTPS in production",
        relevance: ["security", "production", "https"],
        sourceAgents: ["security-auditor"],
      });

      const results = await search("scalable architecture", 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain("microservices");
    });

    it("8. workflow checkpoint save/load/resume", async () => {
      const workflowId = "test-workflow-1";
      await saveCheckpoint(workflowId, {
        workflowId,
        timestamp: new Date().toISOString(),
        state: { step: 3, data: "in-progress" },
        completedSteps: ["init", "design", "build"],
        pendingSteps: ["test", "deploy"],
      });

      const loaded = await loadCheckpoint(workflowId);
      expect(loaded).not.toBeNull();
      expect(loaded!.workflowId).toBe(workflowId);
      expect((loaded!.state as any).step).toBe(3);
      expect(loaded!.completedSteps).toContain("build");
    });

    it("9. cross-project knowledge accumulation", async () => {
      await addKnowledge({
       projectId: "project-a",
        type: "lesson",
        content: "Feature flags enable safe rollouts",
        relevance: ["deployment", "feature-flags"],
        sourceAgents: ["devops-agent"],
      });
      await addKnowledge({
        projectId: "project-b",
        type: "lesson",
        content: "Feature flags also help with A/B testing",
        relevance: ["deployment", "feature-flags", "testing"],
        sourceAgents: ["pm"],
      });

      const results = await search("feature flags", 10);
      expect(results.length).toBe(2);
    });
  });
});
