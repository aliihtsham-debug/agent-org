// ── CEO Config Editor ─────────────────────────────────────────────────
// One-lever CEO config tuning per run.
//
// Safety model:
//   - Only adjusts one lever per proposal.
//   - Delta must be within pre-approved range (config.allowedLeverDelta).
//   - Lever must be in the allowed list (config.allowedLevers).
//   - Never modifies phase toggles (identity, governance, audit, etc.).

import type { ProposedChange } from "../types/meta-types.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The set of CEO levers that can be tuned by the meta-loop.
 * These are numeric parameters that affect CEO behavior.
 */
export const TUNABLE_LEVERS = [
  "maxIterations",
  "minSeverity",
  "maxConcurrent",
  "escalationThreshold",
  "reputationDelta",
  "memoryImportance",
] as const;

export type TunableLever = (typeof TUNABLE_LEVERS)[number];

/**
 * Apply a CEO config tuning proposal to the target file.
 *
 * The patch specifies which lever to adjust and by how much.
 */
export async function applyCEOConfigEdit(
  proposal: ProposedChange,
  projectRoot: string,
): Promise<{ success: boolean; newContent?: string; error?: string }> {
  const filePath = join(projectRoot, proposal.sourceFile);

  try {
    const currentContent = await readFile(filePath, "utf-8");
    const patch = JSON.parse(proposal.patch) as {
      lever?: string;
      fromValue?: number | string;
      toValue?: number | string;
    };

    if (!patch.lever || patch.fromValue === undefined || patch.toValue === undefined) {
      return { success: false, error: "Invalid CEO config patch format" };
    }

    // Validate lever is tunable.
    if (!TUNABLE_LEVERS.includes(patch.lever as TunableLever)) {
      return {
        success: false,
        error: `Lever "${patch.lever}" is not tunable. Allowed: ${TUNABLE_LEVERS.join(", ")}`,
      };
    }

    // Find the lever in the source code.
    // We look for patterns like `maxIterations: 1` or `minSeverity: "high"`.
    const leverPattern = new RegExp(
      `(${escapeRegex(patch.lever)}\\s*:\\s*)${formatValuePattern(patch.fromValue)}`,
    );

    const match = leverPattern.exec(currentContent);
    if (!match) {
      return {
        success: false,
        error: `Lever "${patch.lever}" with value "${String(patch.fromValue)}" not found in source`,
      };
    }

    const replacement = `${match[1]}${formatValueReplacement(patch.toValue)}`;
    const newContent =
      currentContent.slice(0, match.index) +
      replacement +
      currentContent.slice(match.index + match[0].length);

    await writeFile(filePath, newContent, "utf-8");
    return { success: true, newContent };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function formatValuePattern(value: unknown): string {
  if (typeof value === "string") {
    return `["']${escapeRegex(value)}["']`;
  }
  return String(value);
}

function formatValueReplacement(value: unknown): string {
  if (typeof value === "string") {
    return `"${value}"`;
  }
  return String(value);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
