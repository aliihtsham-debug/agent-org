/**
 * Phase 12 — Agent Reputation Scoring
 */

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import type { AgentReputation, ReputationEvent } from "../types/memory-types.js";

function getReputationDir(): string {
  return process.env.AGENT_ORG_MEMORY_DIR ?? "outputs/.memory";
}

function getReputationFile(): string {
  return `${getReputationDir()}/reputations.json`;
}

async function ensureDir(): Promise<void> {
  await mkdir(getReputationDir(), { recursive: true });
}

async function loadAll(): Promise<Map<string, AgentReputation>> {
  const file = getReputationFile();
  try {
    await access(file);
    const raw = await readFile(file, "utf-8");
    const entries = JSON.parse(raw) as [string, AgentReputation][];
    return new Map(entries);
  } catch {
    return new Map();
  }
}

async function saveAll(reputations: Map<string, AgentReputation>): Promise<void> {
  await ensureDir();
  await writeFile(getReputationFile(), JSON.stringify([...reputations.entries()], null, 2));
}

export async function recordEvent(agentId: string, event: ReputationEvent): Promise<void> {
  const all = await loadAll();
  const existing = all.get(agentId) ?? {
    agentId,
    overall: 50,
    quality: 50,
    reliability: 50,
    collaboration: 50,
    history: [],
    lastUpdated: new Date().toISOString(),
  };

  existing.history.push(event);
  existing.lastUpdated = new Date().toISOString();

  // Update scores based on event type
  switch (event.event) {
    case "critique_accepted":
      existing.quality = Math.min(100, existing.quality + event.delta);
      break;
    case "critique_received":
      // Neutral — receiving critiques is normal
      break;
    case "review_given":
      existing.collaboration = Math.min(100, existing.collaboration + event.delta);
      break;
    case "completion":
      existing.reliability = Math.min(100, existing.reliability + event.delta);
      break;
    case "failure":
      existing.reliability = Math.max(0, existing.reliability + event.delta);
      break;
  }

  // Recalculate composite
  existing.overall = Math.round(
    existing.quality * 0.4 + existing.reliability * 0.3 + existing.collaboration * 0.3,
  );

  all.set(agentId, existing);
  await saveAll(all);
}

export async function calculateScore(agentId: string): Promise<AgentReputation> {
  const all = await loadAll();
  return (
    all.get(agentId) ?? {
      agentId,
      overall: 50,
      quality: 50,
      reliability: 50,
      collaboration: 50,
      history: [],
      lastUpdated: new Date().toISOString(),
    }
  );
}

export async function getTopAgents(category: string, limit: number): Promise<AgentReputation[]> {
  const all = await loadAll();
  const values = [...all.values()];

  const key = category as keyof AgentReputation;
  values.sort((a, b) => (b[key] as number) - (a[key] as number));

  return values.slice(0, limit);
}
