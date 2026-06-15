/**
 * Phase 12 — Workflow Checkpoint / Resume
 */

import { readFile, writeFile, mkdir, readdir, access } from "node:fs/promises";
import type { WorkflowCheckpoint } from "../types/memory-types.js";

function getWorkflowDir(): string {
  return process.env.AGENT_ORG_WORKFLOW_DIR ?? "outputs/.workflows";
}

async function ensureDir(): Promise<void> {
  await mkdir(getWorkflowDir(), { recursive: true });
}

function checkpointPath(workflowId: string): string {
  return `${getWorkflowDir()}/${workflowId}.json`;
}

export async function saveCheckpoint(
  workflowId: string,
  state: WorkflowCheckpoint,
): Promise<void> {
  await ensureDir();
  await writeFile(
    checkpointPath(workflowId),
    JSON.stringify({ ...state, timestamp: new Date().toISOString() }, null, 2),
  );
}

export async function loadCheckpoint(workflowId: string): Promise<WorkflowCheckpoint | null> {
  try {
    await access(checkpointPath(workflowId));
    const raw = await readFile(checkpointPath(workflowId), "utf-8");
    return JSON.parse(raw) as WorkflowCheckpoint;
  } catch {
    return null;
  }
}

export async function listWorkflows(): Promise<string[]> {
  const dir = getWorkflowDir();
  try {
    await access(dir);
    const files = await readdir(dir);
    return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
  } catch {
    return [];
  }
}
