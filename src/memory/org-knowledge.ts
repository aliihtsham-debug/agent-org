/**
 * Phase 12 — Cross-Project Organizational Knowledge
 */

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import type { KnowledgeEntry, OrganizationalKnowledge } from "../types/memory-types.js";

function getKnowledgeDir(): string {
  return process.env.AGENT_ORG_MEMORY_DIR ?? "outputs/.memory";
}

function getKnowledgeFile(): string {
  return `${getKnowledgeDir()}/org-knowledge.json`;
}

async function ensureDir(): Promise<void> {
  await mkdir(getKnowledgeDir(), { recursive: true });
}

async function load(): Promise<OrganizationalKnowledge> {
  const file = getKnowledgeFile();
  try {
    await access(file);
    const raw = await readFile(file, "utf-8");
    return JSON.parse(raw) as OrganizationalKnowledge;
  } catch {
    return { entries: [], lastUpdated: new Date().toISOString() };
  }
}

async function save(knowledge: OrganizationalKnowledge): Promise<void> {
  await ensureDir();
  knowledge.lastUpdated = new Date().toISOString();
  await writeFile(getKnowledgeFile(), JSON.stringify(knowledge, null, 2));
}

function generateId(): string {
  try {
    return `kw_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    return `kw_${Date.now()}`;
  }
}

export async function addKnowledge(
  entry: Omit<KnowledgeEntry, "id" | "timestamp">,
): Promise<void> {
  const knowledge = await load();
  knowledge.entries.push({
    ...entry,
    id: generateId(),
    timestamp: new Date().toISOString(),
  });
  await save(knowledge);
}

export async function search(query: string, maxResults: number = 10): Promise<KnowledgeEntry[]> {
  const knowledge = await load();
  if (knowledge.entries.length === 0) return [];

  const queryWords = new Set(query.toLowerCase().split(/\s+/));
  const scored = knowledge.entries.map((entry) => {
    const content = entry.content.toLowerCase();
    let score = 0;
    for (const word of queryWords) {
      if (content.includes(word)) score += 1;
    }
    // Also check tags
    for (const tag of entry.relevance) {
      for (const word of queryWords) {
        if (tag.toLowerCase().includes(word)) score += 2;
      }
    }
    return { entry, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults).filter((s) => s.score > 0).map((s) => s.entry);
}
