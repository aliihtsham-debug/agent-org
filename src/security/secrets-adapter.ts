/**
 * Phase 13 — Secrets Vault Integration
 *
 * Adapter pattern for secrets management.
 * Works standalone with local file-based storage.
 */

import { readFile, writeFile, mkdir, access, rm } from "node:fs/promises";

export interface SecretsProvider {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
  listSecrets(prefix?: string): Promise<string[]>;
}

const SECRETS_DIR = "outputs/.secrets";

async function ensureDir(): Promise<void> {
  await mkdir(SECRETS_DIR, { recursive: true });
}

function sanitizeKey(key: string): string {
  // Prevent path traversal in secret keys
  return key.replace(/[^a-zA-Z0-9._-]/g, "_");
}

class LocalSecretsProvider implements SecretsProvider {
  async getSecret(key: string): Promise<string | null> {
    try {
      await access(`${SECRETS_DIR}/${sanitizeKey(key)}`);
      return await readFile(`${SECRETS_DIR}/${sanitizeKey(key)}`, "utf-8");
    } catch {
      return null;
    }
  }

  async setSecret(key: string, value: string): Promise<void> {
    await ensureDir();
    await writeFile(`${SECRETS_DIR}/${sanitizeKey(key)}`, value);
  }

  async deleteSecret(key: string): Promise<void> {
    try {
      await rm(`${SECRETS_DIR}/${sanitizeKey(key)}`);
    } catch {
      // Already deleted
    }
  }

  async listSecrets(prefix?: string): Promise<string[]> {
    try {
      const { readdir } = await import("node:fs/promises");
      await access(SECRETS_DIR);
      const files = await readdir(SECRETS_DIR);
      return prefix ? files.filter((f) => f.startsWith(prefix)) : files;
    } catch {
      return [];
    }
  }
}

class HashiCorpVaultAdapter implements SecretsProvider {
  async getSecret(_key: string): Promise<string | null> {
    console.log("[HashiCorpVaultAdapter] Vault not configured — returning null");
    return null;
  }

  async setSecret(_key: string, _value: string): Promise<void> {
    console.log("[HashiCorpVaultAdapter] Vault not configured — skipping write");
  }

  async deleteSecret(_key: string): Promise<void> {
    console.log("[HashiCorpVaultAdapter] Vault not configured — skipping delete");
  }

  async listSecrets(_prefix?: string): Promise<string[]> {
    console.log("[HashiCorpVaultAdapter] Vault not configured — returning empty list");
    return [];
  }
}

export function createSecretsProvider(type: "local" | "vault" = "local"): SecretsProvider {
  switch (type) {
    case "vault":
      return new HashiCorpVaultAdapter();
    default:
      return new LocalSecretsProvider();
  }
}
