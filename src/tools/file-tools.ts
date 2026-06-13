import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Create a directory and all parent directories if they do not exist. */
export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/** Read a file's contents, returning null if the file does not exist. */
export async function readFileIfExists(path: string): Promise<string | null> {
  try {
    await access(path);
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/** Write content to a file, creating parent directories as needed. */
export async function writeOutput(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, content, "utf-8");
}

/** List files in a directory, returning an empty array if it does not exist. */
export async function listOutputs(dir: string): Promise<string[]> {
  try {
    await access(dir);
    const { readdir } = await import("node:fs/promises");
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** Build an artifact file path from an output base, subdirectory, and filename. */
export function artifactPath(outputBase: string, subdir: string, filename: string): string {
  return join(outputBase, subdir, filename);
}
