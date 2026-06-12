#!/usr/bin/env tsx

import "dotenv/config";
import { runCEOAgent } from "./orchestrator/ceo-agent.js";
import { AgentLogger } from "./observability/logger.js";
import { startDashboardServer } from "./dashboard/server.js";
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
  npx tsx src/index.ts "<product idea>" [options]

Options:
  --dashboard [port]  Start web dashboard (default port: 3001)
  --approve           Enable human approval gates at milestones
  --help, -h          Show this help

Examples:
  npx tsx src/index.ts "Build a SaaS task management app"
  npx tsx src/index.ts "URL shortener" --dashboard 3001
  npx tsx src/index.ts "Recipe platform" --dashboard --approve

Environment:
  OPENROUTER_API_KEY  Required. Your OpenRouter API key.
  OPENROUTER_BASE_URL Optional. Default: https://openrouter.ai/api/v1

Output:
  outputs/            All agent artifacts, plans, and code scaffolds
  outputs/agent-events.jsonl  Structured event log (JSONL)
  outputs/artifact-manifest.json  Artifact metadata index
`);
}

function parseArgs(argv: string[]): {
  idea: string;
  dashboard: boolean;
  dashboardPort: number;
  enableApproval: boolean;
} {
  let dashboard = false;
  let dashboardPort = 3001;
  let enableApproval = false;
  const ideaParts: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg === "--dashboard") {
      dashboard = true;
      // Check if next arg is a port number
      const next = argv[i + 1];
      if (next && /^\d+$/.test(next)) {
        dashboardPort = parseInt(next, 10);
        i++; // skip port value
      }
    } else if (arg === "--approve") {
      enableApproval = true;
    } else {
      ideaParts.push(arg);
    }
  }

  return { idea: ideaParts.join(" "), dashboard, dashboardPort, enableApproval };
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length === 0) {
    printUsage();
    process.exit(1);
  }

  const { idea, dashboard, dashboardPort, enableApproval } = parseArgs(rawArgs);

  if (!idea) {
    console.error("Error: No product idea provided.");
    printUsage();
    process.exit(1);
  }

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

  // Start dashboard server if requested
  if (dashboard) {
    startDashboardServer(dashboardPort);
  }

  // Handle Ctrl+C gracefully
  process.on("SIGINT", () => {
    console.log("\n\nInterrupted. Artifacts already written to outputs/.");
    process.exit(130);
  });

  const plan = await runCEOAgent({
    idea,
    apiKey,
    baseURL,
    outputBase,
    logger,
    projectRoot: PROJECT_ROOT,
    enableApproval,
  });

  process.exit(plan.status === "failed" ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
