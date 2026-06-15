/**
 * Phase 16 — Blueprint Registry
 *
 * Publish, search, and install organizational blueprints.
 */

import { readFile, writeFile, mkdir, readdir, access, copyFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { OrganizationalBlueprint } from "../types/marketplace-types.js";

function getMarketplaceDir(): string {
  return process.env.AGENT_ORG_MARKETPLACE_DIR ?? "outputs/.marketplace";
}

function getBlueprintsDir(): string {
  return `${getMarketplaceDir()}/blueprints`;
}

async function ensureDir(): Promise<void> {
  await mkdir(getBlueprintsDir(), { recursive: true });
}

function blueprintPath(id: string): string {
  return join(getBlueprintsDir(), `${id}.json`);
}

export class BlueprintRegistry {
  async publishBlueprint(blueprint: OrganizationalBlueprint): Promise<void> {
    await ensureDir();
    await writeFile(blueprintPath(blueprint.id), JSON.stringify(blueprint, null, 2));
  }

  async getBlueprint(id: string): Promise<OrganizationalBlueprint | null> {
    try {
      await access(blueprintPath(id));
      const raw = await readFile(blueprintPath(id), "utf-8");
      return JSON.parse(raw) as OrganizationalBlueprint;
    } catch {
      return null;
    }
  }

  async searchBlueprints(query: string, category?: string): Promise<OrganizationalBlueprint[]> {
    try {
      await access(getBlueprintsDir());
      const files = await readdir(getBlueprintsDir());
      const blueprints: OrganizationalBlueprint[] = [];

      for (const file of files.filter((f) => f.endsWith(".json"))) {
        const raw = await readFile(join(getBlueprintsDir(), file), "utf-8");
        const bp = JSON.parse(raw) as OrganizationalBlueprint;
        blueprints.push(bp);
      }

      const queryLower = query.toLowerCase();
      return blueprints.filter((bp) => {
        const matchesQuery =
          bp.name.toLowerCase().includes(queryLower) ||
          bp.description.toLowerCase().includes(queryLower) ||
          bp.metadata.tags.some((t) => t.toLowerCase().includes(queryLower));
        const matchesCategory = !category || bp.metadata.category === category;
        return matchesQuery && matchesCategory;
      });
    } catch {
      return [];
    }
  }

  async installBlueprint(id: string, target: string): Promise<void> {
    const blueprint = await this.getBlueprint(id);
    if (!blueprint) throw new Error(`Blueprint "${id}" not found`);

    const targetPath = join(target, `blueprint-${id}.json`);
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(blueprintPath(id), targetPath);
  }
}

export function createBlueprintRegistry(): BlueprintRegistry {
  return new BlueprintRegistry();
}
