// ── Meta-Loop Configuration ─────────────────────────────────────────────
// Loads, validates, and saves the meta-loop config from
// `outputs/.meta/config.json`. Falls back to defaults when absent.

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MetaLoopConfig } from "../types/meta-types.js";
import { DEFAULT_META_LOOP_CONFIG } from "../types/meta-types.js";

const META_DIR = ".meta";
const CONFIG_FILE = "config.json";

/**
 * Resolve the meta-loop config path relative to the output base.
 */
export function metaConfigPath(outputBase: string): string {
  return join(outputBase, META_DIR, CONFIG_FILE);
}

/**
 * Load meta-loop config from disk, falling back to defaults for any
 * missing or invalid field. Never throws — always returns a valid config.
 */
export async function loadMetaConfig(outputBase: string): Promise<MetaLoopConfig> {
  const path = metaConfigPath(outputBase);
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<MetaLoopConfig>;
    return validateConfig({ ...DEFAULT_META_LOOP_CONFIG, ...parsed });
  } catch {
    // File missing or malformed — return defaults.
    return { ...DEFAULT_META_LOOP_CONFIG };
  }
}

/**
 * Save meta-loop config to disk. Creates parent directories as needed.
 */
export async function saveMetaConfig(outputBase: string, config: MetaLoopConfig): Promise<void> {
  const path = metaConfigPath(outputBase);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(validateConfig(config), null, 2), "utf-8");
}

/**
 * Validate and clamp config values to safe ranges.
 * Throws on unrecoverable structural errors (e.g., wrong type for required field).
 */
export function validateConfig(input: Partial<MetaLoopConfig>): MetaLoopConfig {
  const cfg = { ...DEFAULT_META_LOOP_CONFIG, ...input };

  // Clamp numeric ranges.
  cfg.windowSize = Math.max(1, Math.min(100, Math.floor(cfg.windowSize)));
  cfg.minConfidence = Math.max(0, Math.min(1, cfg.minConfidence));
  cfg.maxPromptEditsPerRun = Math.max(0, Math.max(10, Math.floor(cfg.maxPromptEditsPerRun)));
  cfg.maxGovernanceTuningsPerRun = Math.max(0, Math.max(10, Math.floor(cfg.maxGovernanceTuningsPerRun)));
  cfg.maxCEOLeverChangesPerRun = Math.max(0, Math.max(10, Math.floor(cfg.maxCEOLeverChangesPerRun)));
  cfg.debounceMs = Math.max(0, Math.min(3_600_000, Math.floor(cfg.debounceMs)));

  // Validate mode.
  const validModes: MetaLoopConfig["mode"][] = ["advisory", "capture", "propose", "apply", "auto"];
  if (!validModes.includes(cfg.mode)) {
    cfg.mode = "advisory";
  }

  return cfg;
}
