// ── Meta CLI Subcommand ───────────────────────────────────────────────
// Standalone entrypoint for meta-loop management commands.
// Usage: npx tsx src/meta-cli.ts <command> [options]
//
// Commands:
//   status          Show pending + applied proposals, last runs
//   rollback <id>   Roll back a specific proposal
//   history [--runs N]  Show sliding-window metrics
//   config          Show current meta-loop configuration

import { join } from "node:path";
import { existsSync } from "node:fs";
import { getMetaStatus, rollbackProposal } from "./meta-loop/meta-orchestrator.js";
import { loadMetaConfig } from "./meta-loop/meta-config.js";
import { readLastNRuns, aggregateRuns } from "./meta-loop/aggregator.js";
import { createLedger } from "./meta-loop/ledger.js";

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  const projectRoot = process.cwd();
  const outputBase = join(projectRoot, "outputs");

  switch (command) {
    case "status":
      await cmdStatus(outputBase, projectRoot);
      break;

    case "rollback": {
      const proposalId = args[1];
      if (!proposalId) {
        console.error("Usage: npx tsx src/meta-cli.ts rollback <proposal-id>");
        process.exit(1);
      }
      await cmdRollback(outputBase, projectRoot, proposalId);
      break;
    }

    case "history": {
      const runsFlag = args.indexOf("--runs");
      const n = runsFlag !== -1 ? parseInt(args[runsFlag + 1] || "10", 10) : 10;
      await cmdHistory(outputBase, n);
      break;
    }

    case "config":
      await cmdConfig(outputBase);
      break;

    default:
      console.log("Meta Loop CLI — Self-Evolving Agent Organization");
      console.log("");
      console.log("Usage: npx tsx src/meta-cli.ts <command> [options]");
      console.log("");
      console.log("Commands:");
      console.log("  status              Show pending + applied proposals, last runs");
      console.log("  rollback <id>       Roll back a specific proposal");
      console.log("  history [--runs N]  Show sliding-window metrics (default: 10)");
      console.log("  config              Show current meta-loop configuration");
      process.exit(command && command !== "help" ? 1 : 0);
  }
}

async function cmdStatus(outputBase: string, projectRoot: string) {
  const status = await getMetaStatus(outputBase, projectRoot);

  console.log("═══ Meta-Loop Status ═══\n");

  console.log(`Ledger valid: ${status.ledgerValid ? "✓" : "✗"}\n`);

  console.log(`Pending proposals: ${status.pendingProposals.length}`);
  for (const p of status.pendingProposals) {
    console.log(`  • ${p.proposalId} [${p.category}] ${p.sourceFile} (confidence: ${p.confidence.toFixed(2)})`);
  }

  console.log(`\nApplied proposals: ${status.appliedProposals.length}`);
  for (const p of status.appliedProposals) {
    console.log(`  • ${p.proposalId} [${p.category}] ${p.sourceFile} at ${p.appliedAt ?? "unknown"}`);
  }

  console.log(`\nLast ${status.lastRuns.length} runs:`);
  for (const run of status.lastRuns) {
    console.log(`  • ${run.runId} (${run.status}) — ${run.totalTokens.input + run.totalTokens.output} tokens, ${run.actionableCritiques} critiques`);
  }
}

async function cmdRollback(outputBase: string, projectRoot: string, proposalId: string) {
  console.log(`Rolling back proposal: ${proposalId}...`);
  const result = await rollbackProposal(outputBase, projectRoot, proposalId);

  if (result.success) {
    console.log(`✓ Successfully rolled back ${proposalId}`);
  } else {
    console.error(`✗ Rollback failed: ${result.error}`);
    process.exit(1);
  }
}

async function cmdHistory(outputBase: string, n: number) {
  console.log(`═══ Meta-Loop History (last ${n} runs) ═══\n`);

  const runs = await readLastNRuns(outputBase, n);
  if (runs.length === 0) {
    console.log("No runs recorded yet. Run with --meta=capture to start collecting.");
    return;
  }

  const window = aggregateRuns(runs);

  console.log(`Total runs in window: ${window.totalRuns}`);
  console.log(`Governance denials: ${Object.values(window.governanceDenials).reduce((a, b) => a + b, 0)}`);

  console.log("\nPer-role metrics:");
  for (const [role, metrics] of Object.entries(window.roleWindows)) {
    console.log(`  ${role}:`);
    console.log(`    runs: ${metrics.runCount}, failureRate: ${(metrics.failureRate * 100).toFixed(1)}%`);
    console.log(`    avgTokens: ${(metrics.avgTokenUtilization * 100).toFixed(1)}%`);
    console.log(`    avgDuration: ${metrics.avgDurationMs.toFixed(0)}ms`);
    console.log(`    reputationTrend: ${metrics.reputationTrend > 0 ? "+" : ""}${metrics.reputationTrend.toFixed(1)}`);
  }

  if (Object.keys(window.pairWindows).length > 0) {
    console.log("\nPer-pair metrics:");
    for (const [pair, metrics] of Object.entries(window.pairWindows)) {
      console.log(`  ${pair}: ${metrics.totalCritiques} critiques, severity trend: ${metrics.severityTrend > 0 ? "+" : ""}${metrics.severityTrend}`);
    }
  }
}

async function cmdConfig(outputBase: string) {
  const config = await loadMetaConfig(outputBase);
  console.log("═══ Meta-Loop Configuration ═══\n");
  console.log(JSON.stringify(config, null, 2));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
