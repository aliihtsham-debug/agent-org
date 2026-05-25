import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function readFileIfExists(path: string): Promise<string | null> {
  try {
    await access(path);
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

export async function writeOutput(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, content, "utf-8");
}

export async function listOutputs(dir: string): Promise<string[]> {
  try {
    await access(dir);
    const { readdir } = await import("node:fs/promises");
    return await readdir(dir);
  } catch {
    return [];
  }
}

export function artifactPath(outputBase: string, subdir: string, filename: string): string {
  return join(outputBase, subdir, filename);
}
