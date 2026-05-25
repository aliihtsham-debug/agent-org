import { execSync } from "node:child_process";

export function createBranch(branchName: string): void {
  try {
    execSync(`git checkout -b ${branchName}`, { stdio: "pipe" });
  } catch {
    // Branch may already exist — that's fine
    execSync(`git checkout ${branchName}`, { stdio: "pipe" });
  }
}

export function commitAll(message: string): void {
  try {
    execSync("git add -A", { stdio: "pipe" });
    execSync(`git commit -m "${message}" --no-verify`, { stdio: "pipe" });
  } catch {
    // Nothing to commit or not a git repo — that's fine
  }
}

export function getDiff(): string {
  try {
    return execSync("git diff HEAD~1 --stat", { stdio: "pipe" }).toString();
  } catch {
    return "";
  }
}
