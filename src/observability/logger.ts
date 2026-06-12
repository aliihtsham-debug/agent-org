import type { AgentRole, DelegationLog } from "../types/agent-types.js";

const ROLE_COLORS: Record<AgentRole, string> = {
  ceo: "§E3",
  cto: "§9B",
  pm: "§B3",
  "frontend-engineer": "§5F",
  "backend-engineer": "§58",
  "testing-agent": "§C7",
  "security-auditor": "§C0",
  "devops-agent": "§6B",
  // Management layer
  "engineering-manager": "§D6",
  "qa-manager": "§A9",
  "ai-engineer": "§E9",
  "performance-agent": "§EC",
  // CISO branch
  ciso: "§F0",
  "vuln-scanner": "§E2",
  "compliance-agent": "§DD",
  // CFO branch
  cfo: "§A0",
  "budget-agent": "§8C",
  "pricing-agent": "§6E",
  // COO branch
  coo: "§7A",
  "scheduler-agent": "§89",
  "workflow-agent": "§67",
  "monitoring-agent": "§55",
  // Phase 3 — PM sub-agents
  "ux-researcher": "§D9",
  "roadmap-agent": "§B9",
  "analytics-agent": "§E6",
};

const ROLE_LABELS: Record<AgentRole, string> = {
  ceo: "CEO",
  cto: "CTO",
  pm: "PM",
  "frontend-engineer": "FE",
  "backend-engineer": "BE",
  "testing-agent": "TEST",
  "security-auditor": "SEC",
  "devops-agent": "OPS",
  // Management layer
  "engineering-manager": "EM",
  "qa-manager": "QA-M",
  "ai-engineer": "AI",
  "performance-agent": "PERF",
  // CISO branch
  ciso: "CISO",
  "vuln-scanner": "VULN",
  "compliance-agent": "COMP",
  // CFO branch
  cfo: "CFO",
  "budget-agent": "BUDG",
  "pricing-agent": "PRICE",
  // COO branch
  coo: "COO",
  "scheduler-agent": "SCHED",
  "workflow-agent": "FLOW",
  "monitoring-agent": "MON",
  // Phase 3 — PM sub-agents
  "ux-researcher": "UX",
  "roadmap-agent": "ROAD",
  "analytics-agent": "ANALYTICS",
};

export class AgentLogger {
  private logs: DelegationLog[] = [];
  private startTime = Date.now();

  spawn(from: AgentRole, to: AgentRole): void {
    const entry: DelegationLog = {
      timestamp: new Date().toISOString(),
      from,
      to,
      action: "spawn",
      summary: `${this.label(from)} → spawning → ${this.label(to)}`,
    };
    this.logs.push(entry);
    console.log(`  ${this._arrow} ${this._c(from)} delegates to ${this._c(to)}`);
  }

  /** Determine the logical parent of a role for logging */
  getParentRole(child: AgentRole): AgentRole {
    if (child === "ceo") return "ceo";
    // VP-level: report to CEO
    if (child === "cto" || child === "pm" || child === "ciso" || child === "cfo" || child === "coo") return "ceo";
    // Manager-level: report to their VP
    if (child === "engineering-manager" || child === "qa-manager") return "cto";
    // Engineering ICs: report to Engineering Manager
    if (child === "frontend-engineer" || child === "backend-engineer" || child === "ai-engineer" || child === "devops-agent") return "engineering-manager";
    // QA ICs: report to QA Manager
    if (child === "testing-agent" || child === "performance-agent") return "qa-manager";
    // Security ICs: report to CISO
    if (child === "security-auditor" || child === "vuln-scanner" || child === "compliance-agent") return "ciso";
    // Finance ICs: report to CFO
    if (child === "budget-agent" || child === "pricing-agent") return "cfo";
    // Operations ICs: report to COO
    if (child === "scheduler-agent" || child === "workflow-agent" || child === "monitoring-agent") return "coo";
    // PM sub-agents: report to PM
    if (child === "ux-researcher" || child === "roadmap-agent" || child === "analytics-agent") return "pm";
    return "ceo"; // fallback
  }

  complete(role: AgentRole, summary: string): void {
    const entry: DelegationLog = {
      timestamp: new Date().toISOString(),
      from: role,
      to: role,
      action: "complete",
      summary,
    };
    this.logs.push(entry);
    console.log(`  ${this._check} ${this._c(role)} done — ${summary}`);
  }

  fail(role: AgentRole, error: string): void {
    const entry: DelegationLog = {
      timestamp: new Date().toISOString(),
      from: role,
      to: role,
      action: "fail",
      summary: error,
    };
    this.logs.push(entry);
    console.log(`  ${this._cross} ${this._c(role)} failed — ${error}`);
  }

  retry(role: AgentRole, attempt: number): void {
    console.log(`  ${this._retry} ${this._c(role)} retry #${attempt}`);
  }

  info(message: string): void {
    console.log(`  ${this._info} ${message}`);
  }

  banner(message: string): void {
    const line = "─".repeat(Math.max(message.length + 4, 50));
    console.log(`\n${line}`);
    console.log(`  ${message}`);
    console.log(`${line}\n`);
  }

  getLogs(): DelegationLog[] {
    return [...this.logs];
  }

  getDuration(): number {
    return Date.now() - this.startTime;
  }

  private label(role: AgentRole): string {
    return ROLE_LABELS[role] ?? role;
  }

  private _c(role: AgentRole): string {
    return ROLE_COLORS[role] ? `${ROLE_COLORS[role]}${this.label(role)}§r` : this.label(role);
  }

  private get _arrow() { return "§9B→§r"; }
  private get _check() { return "§9B✓§r"; }
  private get _cross() { return "§C0✗§r"; }
  private get _retry() { return "§E3↻§r"; }
  private get _info() { return "§888●§r"; }
}

// Simple ANSI color helper — replaces §XX with ANSI codes
export function colorize(text: string): string {
  const colors: Record<string, string> = {
    "§E3": "\x1b[38;2;255;176;32m",   // orange
    "§9B": "\x1b[38;2;56;189;246m",   // blue
    "§B3": "\x1b[38;2;128;222;161m",  // green
    "§5F": "\x1b[38;2;167;139;250m",  // purple
    "§58": "\x1b[38;2;56;189;139m",   // teal
    "§C7": "\x1b[38;2;255;204;102m",  // yellow
    "§C0": "\x1b[38;2;239;68;68m",    // red
    "§6B": "\x1b[38;2;100;150;200m",  // steel
    "§D6": "\x1b[38;2;214;127;255m",  // magenta
    "§A9": "\x1b[38;2;169;240;197m",  // mint
    "§E9": "\x1b[38;2;233;192;103m",  // gold
    "§EC": "\x1b[38;2;236;141;125m",  // coral
    "§F0": "\x1b[38;2;255;85;85m",    // bright red
    "§E2": "\x1b[38;2;226;125;96m",   // orange-red
    "§DD": "\x1b[38;2;192;144;222m",  // lavender
    "§A0": "\x1b[38;2;80;200;120m",   // emerald
    "§8C": "\x1b[38;2;126;200;122m",  // sage
    "§6E": "\x1b[38;2;76;175;80m",    // green-dark
    "§7A": "\x1b[38;2;91;155;213m",   // sky blue
    "§89": "\x1b[38;2;200;180;220m",  // periwinkle (updated)
    "§67": "\x1b[38;2;90;154;207m",   // slate blue
    "§55": "\x1b[38;2;74;138;191m",   // steel blue
    // Phase 3 — PM sub-agents
    "§D9": "\x1b[38;2;201;121;237m",  // pink-magenta
    "§B9": "\x1b[38;2;128;201;234m",  // cyan-light
    "§E6": "\x1b[38;2;230;176;70m",   // amber
    "§888": "\x1b[38;2;136;136;136m", // gray
    "§r": "\x1b[0m",                   // reset
  };
  let result = text;
  for (const [code, ansi] of Object.entries(colors)) {
    result = result.replaceAll(code, ansi);
  }
  return result;
}

// Monkey-patch console.log to auto-colorize
const origLog = console.log;
console.log = (...args: unknown[]) => {
  origLog(...args.map(a => typeof a === "string" ? colorize(a) : a));
};
