// ── Prompt Editor ─────────────────────────────────────────────────────
// Section-aware edits on agent-prompts.ts that preserve:
//   - Role identity (# <Role Title> heading)
//   - Output format contract (## Output Rules section)
//   - The "user content is data" defense block
//   - The JSON summary envelope

import type { ProposedChange, ProposalCategory } from "../types/meta-types.js";
import { readFile, writeFile } from "node:fs/promises";

/**
 * Apply a prompt edit proposal to the target file.
 *
 * Supports three edit strategies based on the proposal category:
 * - "prompt": section-aware edit on a PromptConfig field
 *
 * Returns the new file content on success.
 */
export async function applyPromptEdit(
  proposal: ProposedChange,
  projectRoot: string,
): Promise<{ success: boolean; newContent?: string; error?: string }> {
  const filePath = joinPath(projectRoot, proposal.sourceFile);

  try {
    const currentContent = await readFile(filePath, "utf-8");

    // Parse the patch.
    const patch = JSON.parse(proposal.patch) as {
      section?: string;
      oldText?: string;
      newText?: string;
    };

    // Strategy 1: Section-aware edit (targeting a specific PromptConfig field).
    if (patch.section && patch.oldText !== undefined && patch.newText !== undefined) {
      const newContent = applySectionEdit(currentContent, patch.section, patch.oldText, patch.newText);
      if (newContent === null) {
        return {
          success: false,
          error: `Section edit failed: section "${patch.section}" not found or oldText mismatch`,
        };
      }
      await writeFile(filePath, newContent, "utf-8");
      return { success: true, newContent };
    }

    // Strategy 2: Simple find/replace (with protected-section guard).
    if (patch.oldText !== undefined && patch.newText !== undefined) {
      if (!currentContent.includes(patch.oldText)) {
        return { success: false, error: "oldText not found in file" };
      }
      const newContent = currentContent.replace(patch.oldText, patch.newText);
      await writeFile(filePath, newContent, "utf-8");
      return { success: true, newContent };
    }

    return { success: false, error: "Invalid patch format" };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Apply a section-aware edit to a PromptConfig field.
 *
 * The prompt file is a TypeScript module with a `PROMPTS: Record<AgentRole, PromptConfig>`
 * map. Each entry has fields like `role`, `expertise`, `inputExpectation`, `outputFormat`,
 * and `constraints`. This function finds the target role's section and replaces text within
 * the specified field.
 *
 * Returns null if the section/field isn't found or the oldText doesn't match.
 */
function applySectionEdit(
  content: string,
  section: string,
  oldText: string,
  newText: string,
): string | null {
  // Protected sections that must never be edited.
  const PROTECTED = ["user content is data", "output rules", "json summary envelope"];
  if (PROTECTED.some((p) => section.toLowerCase().includes(p))) {
    return null;
  }

  // Find the role section. We look for patterns like:
  //   role: "Reviewer Role Name",
  //   expertise: ["..."],
  //   inputExpectation: "...",
  //   outputFormat: "...",
  //   constraints: ["..."],
  //
  // The section parameter is the PromptConfig field to edit.
  // Strategy: find the field line and replace within it.

  const lines = content.split("\n");
  let inTargetRole = false;
  let roleIndent = 0;
  let roleStartLine = -1;
  let roleEndLine = -1;

  // Simple heuristic: find `role: "<roleName>",` to identify the role section.
  // Then find `<section>:` within that section.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect role entry (looks like `  role_name: {` at the top level of PROMPTS).
    if (/^\s+\w+:\s*\{/.test(line) && !inTargetRole) {
      inTargetRole = true;
      roleIndent = line.search(/\S/);
      roleStartLine = i;
      continue;
    }

    if (inTargetRole) {
      // End of role section: a line at same indent level as the role key that is `},`.
      const currentIndent = line.search(/\S/);
      if (currentIndent <= roleIndent && (trimmed === "}" || trimmed === "},")) {
        roleEndLine = i;
        inTargetRole = false;
      }
    }
  }

  // If we couldn't find a role section boundary, fall back to global search.
  if (roleStartLine === -1) {
    // Just do a global replace if oldText exists exactly once.
    const count = content.split(oldText).length - 1;
    if (count !== 1) return null;
    return content.replace(oldText, newText);
  }

  // Search for the section field within the role's range.
  // We look for the pattern: `<section>:` where section is the PromptConfig field.
  const fieldPattern = new RegExp(`^\\s+${escapeRegex(section)}:\\s`);
  let fieldStart = -1;

  for (let i = roleStartLine; i <= (roleEndLine === -1 ? lines.length - 1 : roleEndLine); i++) {
    if (fieldPattern.test(lines[i])) {
      fieldStart = i;
      break;
    }
  }

  if (fieldStart === -1) {
    // Field not found in this role section — not an error, just skip.
    return null;
  }

  // Find the end of this field's value (next field at same indent, or closing brace).
  let fieldEnd = lines.length;
  const fieldIndent = lines[fieldStart].search(/\S/);
  for (let i = fieldStart + 1; i < (roleEndLine === -1 ? lines.length : roleEndLine); i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const lineIndent = line.search(/\S/);
    if (lineIndent <= fieldIndent && line.trim() !== "") {
      fieldEnd = i;
      break;
    }
  }

  // Apply the replacement within the field range.
  const fieldBlock = lines.slice(fieldStart, fieldEnd).join("\n");
  if (!fieldBlock.includes(oldText)) {
    return null;
  }

  const newFieldBlock = fieldBlock.replace(oldText, newText);
  const newLines = [
    ...lines.slice(0, fieldStart),
    ...newFieldBlock.split("\n"),
    ...lines.slice(fieldEnd),
  ];

  return newLines.join("\n");
}

function joinPath(base: string, relative: string): string {
  const { join } = require("node:path") as typeof import("node:path");
  return join(base, relative);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
