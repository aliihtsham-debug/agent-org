// ── Phase 8 — Identity Store ────────────────────────────────────────────
// File-based persistence for agent key pairs and identity metadata.

import { mkdir, writeFile, readFile, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentIdentity, AgentKeyPair } from "../types/identity-types.js";

const IDENTITY_DIR = process.env.IDENTITY_STORE_DIR ?? join("outputs", ".identity");

async function ensureDir(): Promise<void> {
  await mkdir(IDENTITY_DIR, { recursive: true });
}

// ── Key Pair Persistence ───────────────────────────────────────────────

export async function saveKeyPair(
  agentId: string,
  keyPair: AgentKeyPair
): Promise<void> {
  await ensureDir();
  const filePath = join(IDENTITY_DIR, `${agentId}.key`);
  const data = JSON.stringify(keyPair, null, 2);
  await writeFile(filePath, data, "utf-8");
}

export async function loadKeyPair(
  agentId: string
): Promise<AgentKeyPair | null> {
  const filePath = join(IDENTITY_DIR, `${agentId}.key`);
  try {
    const data = await readFile(filePath, "utf-8");
    return JSON.parse(data) as AgentKeyPair;
  } catch {
    return null;
  }
}

export async function deleteKeyPair(agentId: string): Promise<void> {
  const filePath = join(IDENTITY_DIR, `${agentId}.key`);
  try {
    await unlink(filePath);
  } catch {
    // File may not exist; ignore
  }
}

// ── Identity Listing ───────────────────────────────────────────────────

export async function listIdentities(): Promise<AgentIdentity[]> {
  await ensureDir();
  let entries: string[];
  try {
    entries = await readdir(IDENTITY_DIR);
  } catch {
    return [];
  }

  const identities: AgentIdentity[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".key")) continue;
    const agentId = entry.slice(0, -4); // strip ".key"
    const filePath = join(IDENTITY_DIR, entry);
    try {
      const data = await readFile(filePath, "utf-8");
      const keyPair = JSON.parse(data) as AgentKeyPair;
      // Reconstruct a minimal identity from stored data
      // Full identity metadata is stored alongside in a .meta file if available
      const metaPath = join(IDENTITY_DIR, `${agentId}.meta`);
      let metadata: AgentIdentity["metadata"];
      try {
        const metaRaw = await readFile(metaPath, "utf-8");
        metadata = JSON.parse(metaRaw);
      } catch {
        metadata = {
          role: "unknown",
          displayName: agentId,
          version: "1.0.0",
        };
      }
      identities.push({
        agentId,
        publicKey: keyPair.publicKey,
        createdAt: new Date().toISOString(),
        metadata,
      });
    } catch {
      // Skip unreadable files
    }
  }
  return identities;
}

// ── Identity Metadata Persistence ──────────────────────────────────────

export async function saveIdentityMetadata(
  agentId: string,
  metadata: AgentIdentity["metadata"]
): Promise<void> {
  await ensureDir();
  const metaPath = join(IDENTITY_DIR, `${agentId}.meta`);
  await writeFile(metaPath, JSON.stringify(metadata, null, 2), "utf-8");
}
