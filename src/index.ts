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
  --approve           Enable human approval gates at milestones (Phase 11)
  --refine            Enable cross-functional iterative refinement (Phase 6)
  --identity          Enable cryptographic agent identity (Phase 8)
  --governance        Enable governance policy engine (Phase 9)
  --audit             Enable hash-chained audit logging (Phase 10)
  --security          Enable security platform — TEE, secrets, zero-trust (Phase 13)
  --memory            Enable persistent agent memory + reputation (Phase 12)
  --marketplace       Enable AI Organization Marketplace (Phase 16)
  --template <name>   Select governance template: default | strict | government | banking (Phase 15)
  --blueprint <id>    Load an organizational blueprint from the marketplace (Phase 16)
  --onboard           Run enterprise onboarding flow (Phase 15)
  --white-label <name>  Configure white-label deployment (Phase 15)
  --full-enterprise   Enable all enterprise phases (8-16) at once
  --meta <mode>       Enable self-evolving meta-loop:
                        capture    — record run signals only (no proposals)
                        propose    — propose changes (written to .meta/)
                        advisory   — print advisory banner (default if no mode)
                        apply      — propose + interactive y/n gate
                        auto       — auto-apply with snapshots (requires AGENT_ORG_META_AUTO=1)
  --meta-window N     Override meta-loop window size (default 10)
  --meta-min-confidence X  Override confidence threshold (0-1, default 0.8)
  --meta-status       Show meta-loop status (pending/applied proposals)
  --meta-rollback <id>  Roll back a specific proposal
  --help, -h          Show this help

Examples:
  npx tsx src/index.ts "Build a SaaS task management app"
  npx tsx src/index.ts "URL shortener" --dashboard 3001
  npx tsx src/index.ts "Recipe platform" --dashboard --approve
  npx tsx src/index.ts "Fintech app" --governance --audit --identity --security
  npx tsx src/index.ts "Gov project" --full-enterprise --template government
  npx tsx src/index.ts "Banking app" --template banking --identity --audit --security

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
  enableMemory: boolean;
  enableMarketplace: boolean;
  templateName: string;
  blueprintId: string;
  runOnboard: boolean;
  whiteLabelName: string;
  metaLoopMode: "capture" | "propose" | "apply" | "auto" | "advisory" | undefined;
  metaWindowSize: number;
  metaMinConfidence: number;
  metaStatus: boolean;
  metaRollback: string;
} {
  let dashboard = false;
  let dashboardPort = 3001;
  let enableApproval = false;
  let enableRefinement = false;
  let enableIdentity = false;
  let enableGovernance = false;
  let enableAudit = false;
  let enableSecurity = false;
  let enableMemory = false;
  let enableMarketplace = false;
  let templateName = "default";
  let blueprintId = "";
  let runOnboard = false;
  let whiteLabelName = "";
  let metaLoopMode: "capture" | "propose" | "apply" | "auto" | "advisory" | undefined;
  let metaWindowSize = 10;
  let metaMinConfidence = 0.8;
  let metaStatus = false;
  let metaRollback = "";
  const ideaParts: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg === "--dashboard") {
      dashboard = true;
      const next = argv[i + 1];
      if (next && /^\d+$/.test(next)) {
        dashboardPort = parseInt(next, 10);
        i++;
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
    } else if (arg === "--memory") {
      enableMemory = true;
    } else if (arg === "--marketplace") {
      enableMarketplace = true;
    } else if (arg === "--full-enterprise") {
      enableIdentity = true;
      enableGovernance = true;
      enableAudit = true;
      enableSecurity = true;
      enableMemory = true;
      enableApproval = true;
      enableMarketplace = true;
    } else if (arg === "--template") {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        templateName = next;
        i++;
      }
    } else if (arg === "--blueprint") {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        blueprintId = next;
        i++;
      }
    } else if (arg === "--onboard") {
      runOnboard = true;
    } else if (arg === "--white-label") {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        whiteLabelName = next;
        i++;
      }
    } else if (arg === "--meta") {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        metaLoopMode = next as typeof metaLoopMode;
        i++;
      } else {
        metaLoopMode = "advisory";
      }
    } else if (arg === "--meta-window") {
      const next = argv[i + 1];
      if (next && /^\d+$/.test(next)) {
        metaWindowSize = parseInt(next, 10);
        i++;
      }
    } else if (arg === "--meta-min-confidence") {
      const next = argv[i + 1];
      if (next && /^\d+(\.\d+)?$/.test(next)) {
        metaMinConfidence = parseFloat(next);
        i++;
      }
    } else if (arg === "--meta-status") {
      metaStatus = true;
    } else if (arg === "--meta-rollback") {
      const next = argv[i + 1];
      if (next) {
        metaRollback = next;
        i++;
      }
    } else {
      ideaParts.push(arg);
    }
  }

  return { idea: ideaParts.join(" "), dashboard, dashboardPort, enableApproval, enableRefinement, enableIdentity, enableGovernance, enableAudit, enableSecurity, enableMemory, enableMarketplace, templateName, blueprintId, runOnboard, whiteLabelName, metaLoopMode, metaWindowSize, metaMinConfidence, metaStatus, metaRollback };
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length === 0) {
    printUsage();
    process.exit(1);
  }

  const { idea, dashboard, dashboardPort, enableApproval, enableRefinement, enableIdentity, enableGovernance, enableAudit, enableSecurity, enableMemory, enableMarketplace, templateName, blueprintId, runOnboard, whiteLabelName, metaLoopMode, metaWindowSize, metaMinConfidence, metaStatus, metaRollback } = parseArgs(rawArgs);
  const linearApiKey = process.env.LINEAR_API_KEY;

  // ── Meta-loop: handle status/rollback commands (run before CEO) ──
  if (metaStatus || metaRollback) {
    const { getMetaStatus, rollbackProposal, loadMetaConfig, saveMetaConfig } = await import("./meta-loop/index.js");
    const outputBase = join(PROJECT_ROOT, "outputs");
    if (metaRollback) {
      const result = await rollbackProposal(outputBase, PROJECT_ROOT, metaRollback);
      if (result.success) {
        console.log(`✓ Rolled back proposal ${metaRollback}`);
      } else {
        console.error(`✗ Rollback failed: ${result.error ?? "unknown error"}`);
        process.exit(1);
      }
    }
    if (metaStatus) {
      const config = await loadMetaConfig(outputBase);
      await saveMetaConfig(outputBase, { ...config, windowSize: metaWindowSize, minConfidence: metaMinConfidence });
      const status = await getMetaStatus(outputBase, PROJECT_ROOT);
      console.log(`\n═══ Meta-Loop Status ═══`);
      console.log(`Mode: ${config.mode} | Window: ${config.windowSize} | Min confidence: ${config.minConfidence}`);
      console.log(`Pending proposals: ${status.pendingProposals.length}`);
      console.log(`Applied proposals: ${status.appliedProposals.length}`);
      console.log(`Ledger valid: ${status.ledgerValid.valid ? "✓" : "✗"}`);
      if (status.lastRuns.length > 0) {
        console.log(`Last runs: ${status.lastRuns.length}`);
        for (const run of status.lastRuns.slice(-5)) {
          console.log(`  ${run.runId.slice(0, 8)}… — ${run.status} (${run.actionableCritiques} actionable critiques)`);
        }
      }
    }
    process.exit(0);
  }

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

  // Apply meta-loop config overrides from CLI flags.
  if (metaLoopMode) {
    const { loadMetaConfig, saveMetaConfig } = await import("./meta-loop/index.js");
    const config = await loadMetaConfig(outputBase);
    await saveMetaConfig(outputBase, {
      ...config,
      enabled: true,
      mode: metaLoopMode,
      windowSize: metaWindowSize,
      minConfidence: metaMinConfidence,
    });
  }

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
    enableMemory,
    enableMarketplace,
    templateName,
    blueprintId,
    runOnboard,
    whiteLabelName,
    metaLoopMode,
  });

  process.exit(plan.status === "failed" ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
