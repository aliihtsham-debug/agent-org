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
    if (child === "cto" || child === "pm") return "ceo";
    return "cto"; // all IC agents report to CTO
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
