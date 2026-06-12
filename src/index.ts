#!/usr/bin/env tsx

import "dotenv/config";
import { runCEOAgent } from "./orchestrator/ceo-agent.js";
import { AgentLogger } from "./observability/logger.js";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

function printUsage(): void {
  console.log(`
Agent Org — Multi-Agent Orchestration System
=============================================

Usage:
  npx tsx src/index.ts "<product idea>"

Examples:
  npx tsx src/index.ts "Build a SaaS task management app"
  npx tsx src/index.ts "Create a recipe sharing platform with AI meal planning"
  npx tsx src/index.ts "URL shortener with analytics dashboard"

Environment:
  OPENROUTER_API_KEY  Required. Your OpenRouter API key.
  OPENROUTER_BASE_URL Optional. Default: https://openrouter.ai/api/v1

Output:
  outputs/           All agent artifacts, plans, and code scaffolds
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const idea = args.join(" ");
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseURL = process.env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL;

  if (!apiKey) {
    console.error("Error: OPENROUTER_API_KEY environment variable is not set.");
    console.error("Create a .env file with: OPENROUTER_API_KEY=sk-or-v1-...");
    console.error("Get a key at: https://openrouter.ai/keys");
    process.exit(1);
  }

  const outputBase = join(PROJECT_ROOT, "outputs");
  await mkdir(outputBase, { recursive: true });

  const logger = new AgentLogger();

  // Handle Ctrl+C gracefully
  process.on("SIGINT", () => {
    console.log("\n\nInterrupted. Artifacts already written to outputs/.");
    process.exit(130);
  });

  const plan = await runCEOAgent({ idea, apiKey, baseURL, outputBase, logger, projectRoot: PROJECT_ROOT });

  process.exit(plan.status === "failed" ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
