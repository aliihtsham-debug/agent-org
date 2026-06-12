import { appendFileSync, writeFileSync, statSync, existsSync, mkdirSync } from "node:fs";
import { relative } from "node:path";
import type { AgentEvent } from "./events.js";
import type { AgentResult } from "../types/agent-types.js";

export interface ArtifactEntry {
  role: string;
  path: string;
  timestamp: string;
  sizeBytes: number;
  status: string;
  summary: string;
}

/**
 * Create handlers for structured logging and artifact manifest tracking.
 *
 * - `onEvent(event)` appends a JSONL line to `outputs/agent-events.jsonl`.
 * - `onArtifact(result, projectRoot)` records artifact metadata in
 *   `outputs/artifact-manifest.json`.
 */
export function createStructuredLogHandlers(outputBase: string) {
  const jsonlPath = `${outputBase}/agent-events.jsonl`;
  const manifestPath = `${outputBase}/artifact-manifest.json`;
  const artifacts: ArtifactEntry[] = [];

  if (!existsSync(outputBase)) mkdirSync(outputBase, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify({ artifacts: [] }, null, 2));

  const onEvent = (event: AgentEvent): void => {
    try {
      appendFileSync(jsonlPath, JSON.stringify(event) + "\n");
    } catch {
      // Non-fatal: structured log write failure should not stop execution
    }
  };

  const onArtifact = (result: AgentResult, projectRoot: string): void => {
    for (const artifactPath of result.artifacts) {
      let sizeBytes = 0;
      try {
        sizeBytes = statSync(artifactPath).size;
      } catch {
        // File may not exist on disk
      }

      artifacts.push({
        role: result.role,
        path: relative(projectRoot, artifactPath),
        timestamp: new Date().toISOString(),
        sizeBytes,
        status: result.status,
        summary: result.summary,
      });
    }
    try {
      writeFileSync(manifestPath, JSON.stringify({ artifacts }, null, 2));
    } catch {
      // Non-fatal
    }
  };

  return { onEvent, onArtifact };
}
