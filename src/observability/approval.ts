import { createInterface } from "node:readline";

/**
 * Prompt the user for approval via CLI stdin.
 * Returns true if user enters 'y' or 'yes', false otherwise.
 */
export function promptApproval(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(`\n  ${question} [y/n]: `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
}
