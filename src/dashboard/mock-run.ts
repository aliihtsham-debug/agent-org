#!/usr/bin/env tsx

/**
 * Dashboard Mock Runner
 *
 * Starts the dashboard server and feeds it simulated agent events
 * so you can test the web UI without an API key or real orchestration.
 *
 * Usage:
 *   npx tsx src/dashboard/mock-run.ts [port]
 *
 * Then open http://localhost:3001 in your browser.
 */

import { startDashboardServer, broadcastEvent, updateStatus } from "./server.js";
import type { AgentEvent } from "../observability/events.js";

// ── Org chart definition (role, parent, label) ──
const ORG: { role: string; parent: string; label: string }[] = [
  { role: "ceo", parent: "", label: "CEO" },
  // VPs
  { role: "pm", parent: "ceo", label: "PM" },
  { role: "cto", parent: "ceo", label: "CTO" },
  { role: "ciso", parent: "ceo", label: "CISO" },
  { role: "cfo", parent: "ceo", label: "CFO" },
  { role: "coo", parent: "ceo", label: "COO" },
  // PM sub-agents
  { role: "ux-researcher", parent: "pm", label: "UX Researcher" },
  { role: "roadmap-agent", parent: "pm", label: "Roadmap" },
  { role: "analytics-agent", parent: "pm", label: "Analytics" },
  // CTO branch
  { role: "engineering-manager", parent: "cto", label: "Eng Manager" },
  { role: "qa-manager", parent: "cto", label: "QA Manager" },
  { role: "frontend-engineer", parent: "engineering-manager", label: "Frontend" },
  { role: "backend-engineer", parent: "engineering-manager", label: "Backend" },
  { role: "ai-engineer", parent: "engineering-manager", label: "AI Engineer" },
  { role: "devops-agent", parent: "engineering-manager", label: "DevOps" },
  { role: "testing-agent", parent: "qa-manager", label: "Testing" },
  { role: "performance-agent", parent: "qa-manager", label: "Performance" },
  // CISO branch
  { role: "security-auditor", parent: "ciso", label: "Sec Auditor" },
  { role: "vuln-scanner", parent: "ciso", label: "Vuln Scanner" },
  { role: "compliance-agent", parent: "ciso", label: "Compliance" },
  // CFO branch
  { role: "budget-agent", parent: "cfo", label: "Budget" },
  { role: "pricing-agent", parent: "cfo", label: "Pricing" },
  // COO branch
  { role: "scheduler-agent", parent: "coo", label: "Scheduler" },
  { role: "workflow-agent", parent: "coo", label: "Workflow" },
  { role: "monitoring-agent", parent: "coo", label: "Monitoring" },
];

const GATE_AFTER = 12; // emit approval gate after this many agents

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(min = 300, max = 800): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function runMockOrchestration(port: number): Promise<void> {
  const server = startDashboardServer(port);
  updateStatus("running");

  console.log("  Simulating agent orchestration...\n");

  const completed = new Set<string>();
  let gateEmitted = false;

  for (let i = 0; i < ORG.length; i++) {
    const agent = ORG[i];
    const now = new Date().toISOString();

    // Spawn event
    const spawnEvent: AgentEvent = {
      type: "spawn",
      timestamp: now,
      from: agent.parent || undefined,
      to: agent.role,
      summary: `${agent.parent || "CEO"} → spawning → ${agent.label}`,
    };
    broadcastEvent(spawnEvent);

    // Simulate work time (200-600ms)
    await sleep(randomDelay(200, 600));

    // Complete event
    const completeEvent: AgentEvent = {
      type: "complete",
      timestamp: new Date().toISOString(),
      role: agent.role,
      summary: `${agent.label} completed successfully`,
    };
    broadcastEvent(completeEvent);
    completed.add(agent.role);

    // Emit approval gate halfway through
    if (i === GATE_AFTER && !gateEmitted) {
      gateEmitted = true;
      await sleep(500);
      const gateEvent: AgentEvent = {
        type: "gate",
        timestamp: new Date().toISOString(),
        summary: `VP outputs ready: ${completed.size} agents completed. Awaiting approval...`,
      };
      broadcastEvent(gateEvent);
      console.log("  ⏸  Approval gate emitted — check the dashboard for the gate banner");
      await sleep(4000); // pause so user can see the gate state
    }

    // Small delay between agents
    await sleep(randomDelay(100, 300));
  }

  // Final summary event
  broadcastEvent({
    type: "info",
    timestamp: new Date().toISOString(),
    summary: `All ${ORG.length} agents completed. Total tokens: ~7,200`,
  });

  updateStatus("complete");
  console.log(`\n  ✓ Mock orchestration complete — ${ORG.length} agents finished`);
  console.log("  Dashboard will stay alive for 30s. Press Ctrl+C to exit early.\n");

  // Keep server alive for inspection
  await sleep(30000);
  server.close();
  process.exit(0);
}

// ── Entry point ──
const port = parseInt(process.argv[2] || "3001", 10);
runMockOrchestration(port).catch((err) => {
  console.error("Mock run failed:", err);
  process.exit(1);
});
