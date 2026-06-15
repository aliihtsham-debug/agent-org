/**
 * Phase 12 — Persistent Agent Memory
 */

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import type { AgentMemory, MemoryEntry } from "../types/memory-types.js";

function getMemoryDir(): string {
  return process.env.AGENT_ORG_MEMORY_DIR ?? "outputs/.memory";
}

async function ensureDir(): Promise<void> {
  await mkdir(getMemoryDir(), { recursive: true });
}

function memoryPath(agentId: string): string {
  return `${getMemoryDir()}/${agentId}.json`;
}

export async function loadMemory(agentId: string): Promise<AgentMemory> {
  try {
    await access(memoryPath(agentId));
    const raw = await readFile(memoryPath(agentId), "utf-8");
    return JSON.parse(raw) as AgentMemory;
  } catch {
    return {
      agentId,
      agentDid: `did:agent:${agentId}`,
      entries: [],
      summary: "",
      lastUpdated: new Date().toISOString(),
      version: 1,
    };
  }
}

export async function saveMemory(memory: AgentMemory): Promise<void> {
  await ensureDir();
  memory.lastUpdated = new Date().toISOString();
  await writeFile(memoryPath(memory.agentId), JSON.stringify(memory, null, 2));
}

export async function addEntry(agentId: string, entry: MemoryEntry): Promise<void> {
  const memory = await loadMemory(agentId);
  memory.entries.push(entry);
  // Keep max 100 entries per agent
  if (memory.entries.length > 100) {
    memory.entries = memory.entries.slice(-100);
  }
  await saveMemory(memory);
}

export async function retrieveRelevant(
  agentId: string,
  context: string,
  maxEntries: number = 5,
): Promise<MemoryEntry[]> {
  const memory = await loadMemory(agentId);
  if (memory.entries.length === 0) return [];

  // Simple keyword matching relevance
  const contextWords = new Set(context.toLowerCase().split(/\s+/));
  const scored = memory.entries.map((entry) => {
    const entryWords = new Set(entry.content.toLowerCase().split(/\s+/));
    let score = 0;
    for (const word of contextWords) {
      if (entryWords.has(word)) score += 1;
    }
    // Factor in importance
    score += entry.importance * 2;
    return { entry, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxEntries).map((s) => s.entry);
}

export async function compressSummary(agentId: string, maxChars: number = 2000): Promise<string> {
  const memory = await loadMemory(agentId);
  if (memory.entries.length === 0) return "";

  // Sort by importance and recency
  const sorted = [...memory.entries].sort((a, b) => {
    const scoreA = a.importance * 10 + new Date(a.timestamp).getTime() / 1e12;
    const scoreB = b.importance * 10 + new Date(b.timestamp).getTime() / 1e12;
    return scoreB - scoreA;
  });

  let summary = "";
  for (const entry of sorted) {
    const line = `[${entry.type}] ${entry.content}\n`;
    if (summary.length + line.length > maxChars) break;
    summary += line;
  }

  // Update stored summary
  memory.summary = summary;
  await saveMemory(memory);

  return summary;
}
