/**
 * Phase 16 — AI Organization Marketplace Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { BlueprintRegistry, createBlueprintRegistry } from "../src/marketplace/blueprint-registry.js";
import { AGENT_PACKS, STARTUP_CTO_PACK, SECURITY_FIRST_PACK } from "../src/marketplace/agent-pack.js";
import { WORKFLOW_TEMPLATES, FEATURE_LAUNCH_PIPELINE, SECURITY_AUDIT_WORKFLOW } from "../src/marketplace/workflows.js";
import type { OrganizationalBlueprint } from "../src/types/marketplace-types.js";

const TEST_MARKETPLACE_DIR = `outputs/.marketplace-test-${Date.now()}`;

function makeBlueprint(id: string, name: string, tags: string[] = [], category: string = "general"): OrganizationalBlueprint {
  return {
    id,
    name,
    description: `Blueprint: ${name}`,
    version: "1.0.0",
    author: "test",
    license: "MIT",
    agentRoles: [{ role: "ceo" }, { role: "cto" }],
    governanceTemplate: "default",
    metadata: { tags, category, rating: 4.5, downloads: 100 },
  };
}

describe("Phase 16 — AI Organization Marketplace", () => {
  describe("Agent Packs", () => {
    it("1. has 4 pre-built agent packs", () => {
      expect(AGENT_PACKS.length).toBe(4);
    });

    it("2. STARTUP_CTO_PACK has correct structure", () => {
      expect(STARTUP_CTO_PACK.id).toBe("startup-cto");
      expect(STARTUP_CTO_PACK.name).toBe("Startup CTO Pack");
      expect(STARTUP_CTO_PACK.tags).toContain("startup");
      expect(STARTUP_CTO_PACK.blueprints.length).toBeGreaterThan(0);
    });

    it("3. SECURITY_FIRST_PACK has correct structure", () => {
      expect(SECURITY_FIRST_PACK.id).toBe("security-first");
      expect(SECURITY_FIRST_PACK.tags).toContain("security");
      expect(SECURITY_FIRST_PACK.tags).toContain("compliance");
    });

    it("4. all packs have unique IDs", () => {
      const ids = AGENT_PACKS.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("Workflow Templates", () => {
    it("5. has 3 workflow templates", () => {
      expect(WORKFLOW_TEMPLATES.length).toBe(3);
    });

    it("6. FEATURE_LAUNCH_PIPELINE has 6 steps in order", () => {
      expect(FEATURE_LAUNCH_PIPELINE.steps.length).toBe(6);
      expect(FEATURE_LAUNCH_PIPELINE.steps[0].order).toBe(1);
      expect(FEATURE_LAUNCH_PIPELINE.steps[0].name).toBe("Product Design");
      expect(FEATURE_LAUNCH_PIPELINE.steps[5].name).toBe("Deployment");
    });

    it("7. SECURITY_AUDIT_WORKFLOW has 4 steps", () => {
      expect(SECURITY_AUDIT_WORKFLOW.steps.length).toBe(4);
      expect(SECURITY_AUDIT_WORKFLOW.steps[0].agentRole).toBe("vuln-scanner");
    });

    it("8. all templates have tags", () => {
      for (const template of WORKFLOW_TEMPLATES) {
        expect(template.tags.length).toBeGreaterThan(0);
      }
    });

    it("9. step orders are sequential", () => {
      for (const template of WORKFLOW_TEMPLATES) {
        template.steps.forEach((step, i) => {
          expect(step.order).toBe(i + 1);
        });
      }
    });
  });

  describe("Blueprint Registry", () => {
    let registry: BlueprintRegistry;

    beforeEach(async () => {
      process.env.AGENT_ORG_MARKETPLACE_DIR = TEST_MARKETPLACE_DIR;
      await rm(TEST_MARKETPLACE_DIR, { recursive: true, force: true }).catch(() => {});
      await mkdir(TEST_MARKETPLACE_DIR, { recursive: true });
      registry = new BlueprintRegistry();
    });

    afterEach(async () => {
      delete process.env.AGENT_ORG_MARKETPLACE_DIR;
      await rm(TEST_MARKETPLACE_DIR, { recursive: true, force: true }).catch(() => {});
    });

    it("10. publishes and retrieves a blueprint", async () => {
      const bp = makeBlueprint("test-bp-1", "Test Blueprint", ["test"]);
      await registry.publishBlueprint(bp);

      const retrieved = await registry.getBlueprint("test-bp-1");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe("test-bp-1");
      expect(retrieved!.name).toBe("Test Blueprint");
    });

    it("11. returns null for non-existent blueprint", async () => {
      const retrieved = await registry.getBlueprint("does-not-exist");
      expect(retrieved).toBeNull();
    });

    it("12. searchBlueprints finds by name", async () => {
      const bp = makeBlueprint("search-test", "My Special Blueprint", ["special"]);
      await registry.publishBlueprint(bp);

      const results = await registry.searchBlueprints("Special");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toContain("Special");
    });

    it("13. searchBlueprints finds by tag", async () => {
      const bp = makeBlueprint("tag-test", "Tagged BP", ["mytag", "other"]);
      await registry.publishBlueprint(bp);

      const results = await registry.searchBlueprints("mytag");
      expect(results.length).toBeGreaterThan(0);
    });

    it("14. searchBlueprints filters by category", async () => {
      const bp1 = makeBlueprint("cat-1", "BP One", [], "engineering");
      const bp2 = makeBlueprint("cat-2", "BP Two", [], "security");
      await registry.publishBlueprint(bp1);
      await registry.publishBlueprint(bp2);

      const results = await registry.searchBlueprints("BP", "engineering");
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("cat-1");
    });

    it("15. searchBlueprints returns empty for no match", async () => {
      const bp = makeBlueprint("no-match", "Some BP", ["tag"]);
      await registry.publishBlueprint(bp);

      const results = await registry.searchBlueprints("zzzzzzz");
      expect(results.length).toBe(0);
    });

    it("16. createBlueprintRegistry factory returns instance", () => {
      const reg = createBlueprintRegistry();
      expect(reg).toBeInstanceOf(BlueprintRegistry);
    });
  });
});
