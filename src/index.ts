#!/usr/bin/env tsx

import "dotenv/config";
import { runCEOAgent } from "./orchestrator/ceo-agent.js";
import { AgentLogger } from "./observability/logger.js";
import { startDashboardServer } from "./dashboard/server.js";
import { configureLLMConcurrency } from "./agents/base-agent.js";
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
  --refine            Enable cross-functional iterative refinement (Phase 6)
  --identity          Enable cryptographic agent identity (Phase 8)
  --governance        Enable governance policy engine (Phase 9)
  --audit             Enable hash-chained audit logging (Phase 10)
  --security          Enable security platform — TEE, secrets, zero-trust (Phase 13)
  --help, -h          Show this help

Examples:
  npx tsx src/index.ts "Build a SaaS task management app"
  npx tsx src/index.ts "URL shortener" --dashboard 3001
  npx tsx src/index.ts "Recipe platform" --dashboard --approve
  npx tsx src/index.ts "Fintech app" --governance --audit --identity --security

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
  enableRefinement: boolean;
  enableIdentity: boolean;
  enableGovernance: boolean;
  enableAudit: boolean;
  enableSecurity: boolean;
} {
  let dashboard = false;
  let dashboardPort = 3001;
  let enableApproval = false;
  let enableRefinement = false;
  let enableIdentity = false;
  let enableGovernance = false;
  let enableAudit = false;
  let enableSecurity = false;
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
    } else if (arg === "--refine") {
      enableRefinement = true;
    } else if (arg === "--identity") {
      enableIdentity = true;
    } else if (arg === "--governance") {
      enableGovernance = true;
    } else if (arg === "--audit") {
      enableAudit = true;
    } else if (arg === "--security") {
      enableSecurity = true;
    } else {
      ideaParts.push(arg);
    }
  }

  return { idea: ideaParts.join(" "), dashboard, dashboardPort, enableApproval, enableRefinement, enableIdentity, enableGovernance, enableAudit, enableSecurity };
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length === 0) {
    printUsage();
    process.exit(1);
  }

  const { idea, dashboard, dashboardPort, enableApproval, enableRefinement, enableIdentity, enableGovernance, enableAudit, enableSecurity } = parseArgs(rawArgs);
  const linearApiKey = process.env.LINEAR_API_KEY;

  if (!idea) {
    console.error("Error: No product idea provided.");
    printUsage();
    process.exit(1);
  }

  // SECURITY: Cap idea length to prevent context-window exhaustion / cost amplification.
  // 10 KB is generous for any product idea while preventing abuse.
  const MAX_IDEA_LENGTH = 10_000;
  if (idea.length > MAX_IDEA_LENGTH) {
    console.error(`Error: Product idea exceeds maximum length of ${MAX_IDEA_LENGTH} characters (got ${idea.length}).`);
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

  // Configure LLM concurrency limit from env variable (default: 8)
  const llmMaxConcurrent = parseInt(process.env.LLM_MAX_CONCURRENT ?? "8", 10);
  configureLLMConcurrency(llmMaxConcurrent);

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
    enableRefinement,
    linearApiKey,
    enableIdentity,
    enableGovernance,
    enableAudit,
    enableSecurity,
  });

  process.exit(plan.status === "failed" ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
