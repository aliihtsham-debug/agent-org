import { execFileSync, execSync } from "node:child_process";

/**
 * Create a new git branch, or switch to it if it already exists.
 * Uses execFileSync to avoid shell injection.
 */
export function createBranch(branchName: string): void {
  try {
    execFileSync("git", ["checkout", "-b", branchName], { stdio: "pipe" });
  } catch {
    // Branch may already exist — that's fine
    execFileSync("git", ["checkout", branchName], { stdio: "pipe" });
  }
}

/**
 * Stage all changes and commit with the given message.
 * Uses execFileSync to avoid shell injection. Non-fatal on failure.
 */
export function commitAll(message: string): void {
  try {
    execFileSync("git", ["add", "-A"], { stdio: "pipe" });
    execFileSync("git", ["commit", "-m", message, "--no-verify"], { stdio: "pipe" });
  } catch {
    // Nothing to commit or not a git repo — that's fine
  }
}

/**
 * Get a summary of changes from the last commit (git diff HEAD~1 --stat).
 * Returns an empty string if git is not available.
 */
export function getDiff(): string {
  try {
    return execSync("git diff HEAD~1 --stat", { stdio: "pipe" }).toString();
  } catch {
    return "";
  }
}
