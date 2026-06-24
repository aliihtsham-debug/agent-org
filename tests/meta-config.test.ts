import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadMetaConfig, saveMetaConfig, validateConfig, metaConfigPath } from "../src/meta-loop/meta-config.js";
import { DEFAULT_META_LOOP_CONFIG } from "../src/types/meta-types.js";

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `meta-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("meta-config", () => {
  describe("loadMetaConfig", () => {
    it("returns defaults when no config file exists", async () => {
      const config = await loadMetaConfig(testDir);
      expect(config.enabled).toBe(false);
      expect(config.mode).toBe("advisory");
      expect(config.windowSize).toBe(10);
    });

    it("merges saved config over defaults", async () => {
      const partial = { enabled: true, mode: "capture" as const, windowSize: 5 };
      await mkdir(join(testDir, ".meta"), { recursive: true });
      await writeFile(join(testDir, ".meta", "config.json"), JSON.stringify(partial));
      const config = await loadMetaConfig(testDir);
      expect(config.enabled).toBe(true);
      expect(config.mode).toBe("capture");
      expect(config.windowSize).toBe(5);
      // Defaults preserved for non-specified fields.
      expect(config.minConfidence).toBe(DEFAULT_META_LOOP_CONFIG.minConfidence);
    });

    it("handles malformed JSON gracefully", async () => {
      await mkdir(join(testDir, ".meta"), { recursive: true });
      await writeFile(join(testDir, ".meta", "config.json"), "not valid json{{{");
      const config = await loadMetaConfig(testDir);
      expect(config).toEqual(expect.objectContaining(DEFAULT_META_LOOP_CONFIG));
    });
  });

  describe("saveMetaConfig", () => {
    it("writes config to disk", async () => {
      const config = { ...DEFAULT_META_LOOP_CONFIG, enabled: true, mode: "propose" };
      await saveMetaConfig(testDir, config);
      const raw = await readFile(join(testDir, ".meta", "config.json"), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.enabled).toBe(true);
      expect(parsed.mode).toBe("propose");
    });

    it("creates parent directories as needed", async () => {
      const config = { ...DEFAULT_META_LOOP_CONFIG, enabled: true };
      await saveMetaConfig(testDir, config);
      const raw = await readFile(join(testDir, ".meta", "config.json"), "utf-8");
      expect(JSON.parse(raw).enabled).toBe(true);
    });
  });

  describe("validateConfig", () => {
    it("clamps windowSize to [1, 100]", () => {
      expect(validateConfig({ windowSize: 0 }).windowSize).toBe(1);
      expect(validateConfig({ windowSize: 1000 }).windowSize).toBe(100);
      expect(validateConfig({ windowSize: 50 }).windowSize).toBe(50);
    });

    it("clamps minConfidence to [0, 1]", () => {
      expect(validateConfig({ minConfidence: -0.5 }).minConfidence).toBe(0);
      expect(validateConfig({ minConfidence: 1.5 }).minConfidence).toBe(1);
      expect(validateConfig({ minConfidence: 0.5 }).minConfidence).toBe(0.5);
    });

    it("rejects invalid mode", () => {
      expect(validateConfig({ mode: "invalid" as any }).mode).toBe("advisory");
    });

    it("preserves valid mode", () => {
      expect(validateConfig({ mode: "auto" }).mode).toBe("auto");
      expect(validateConfig({ mode: "capture" }).mode).toBe("capture");
    });
  });

  describe("metaConfigPath", () => {
    it("returns correct path", () => {
      expect(metaConfigPath("/tmp/test")).toBe(join("/tmp/test", ".meta", "config.json"));
    });
  });
});
