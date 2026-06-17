import type { AgentRole, DelegationLog } from "../types/agent-types.js";
import { AgentEventEmitter, generateEventId, type AgentEvent } from "./events.js";

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
  // Phase 7 — Linear integration
  "linear-mapper": "§4A",
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
  // Phase 7 — Linear integration
  "linear-mapper": "LIN",
};

/** Maps each role to its logical parent in the org chart. */
const ROLE_PARENT: Record<AgentRole, AgentRole> = {
  ceo: "ceo",
  cto: "ceo",
  pm: "ceo",
  ciso: "ceo",
  cfo: "ceo",
  coo: "ceo",
  "engineering-manager": "cto",
  "qa-manager": "cto",
  "frontend-engineer": "engineering-manager",
  "backend-engineer": "engineering-manager",
  "ai-engineer": "engineering-manager",
  "devops-agent": "engineering-manager",
  "testing-agent": "qa-manager",
  "performance-agent": "qa-manager",
  "security-auditor": "ciso",
  "vuln-scanner": "ciso",
  "compliance-agent": "ciso",
  "budget-agent": "cfo",
  "pricing-agent": "cfo",
  "scheduler-agent": "coo",
  "workflow-agent": "coo",
  "monitoring-agent": "coo",
  "ux-researcher": "pm",
  "roadmap-agent": "pm",
  "analytics-agent": "pm",
  "linear-mapper": "ceo",
};

export class AgentLogger {
  private logs: DelegationLog[] = [];
  private startTime = Date.now();
  private emitter?: AgentEventEmitter;
  /** Run-level correlation ID — shared by all events in a single CEO execution */
  private runId?: string;
  /** Total retry count across all agents (for run summary metrics) */
  private retryCount = 0;

  setEmitter(emitter: AgentEventEmitter): void {
    this.emitter = emitter;
  }

  /** Set the run ID for correlation. Called once at CEO start. */
  setRunId(runId: string): void {
    this.runId = runId;
  }

  getRunId(): string | undefined {
    return this.runId;
  }

  getRetryCount(): number {
    return this.retryCount;
  }

  spawn(from: AgentRole, to: AgentRole): string {
    const eventId = generateEventId();
    const entry: DelegationLog = {
      timestamp: new Date().toISOString(),
      from,
      to,
      action: "spawn",
      summary: `${this.label(from)} -> spawning -> ${this.label(to)}`,
    };
    this.logs.push(entry);
    console.log(`  ${this._arrow} ${this._c(from)} delegates to ${this._c(to)}`);
    this.emitter?.emit({
      type: "spawn",
      timestamp: entry.timestamp,
      eventId,
      runId: this.runId ?? "unknown",
      from,
      to,
      summary: entry.summary,
    });
    return eventId;
  }

  /** Determine the logical parent of a role for logging. */
  getParentRole(child: AgentRole): AgentRole {
    return ROLE_PARENT[child] ?? "ceo";
  }

  complete(role: AgentRole, summary: string, parentEventId?: string): void {
    const eventId = generateEventId();
    const entry: DelegationLog = {
      timestamp: new Date().toISOString(),
      from: role,
      to: role,
      action: "complete",
      summary,
    };
    this.logs.push(entry);
    console.log(`  ${this._check} ${this._c(role)} done -- ${summary}`);
    this.emitter?.emit({
      type: "complete",
      timestamp: entry.timestamp,
      eventId,
      runId: this.runId ?? "unknown",
      role,
      summary,
      parentEventId,
    });
  }

  fail(role: AgentRole, error: string, operation?: string, errorType?: "timeout" | "rate_limit" | "server" | "auth" | "unknown", parentEventId?: string): void {
    const eventId = generateEventId();
    const entry: DelegationLog = {
      timestamp: new Date().toISOString(),
      from: role,
      to: role,
      action: "fail",
      summary: error,
    };
    this.logs.push(entry);
    console.log(`  ${this._cross} ${this._c(role)} failed -- ${error}`);
    this.emitter?.emit({
      type: "fail",
      timestamp: entry.timestamp,
      eventId,
      runId: this.runId ?? "unknown",
      role,
      error,
      operation,
      errorType,
      parentEventId,
    });
  }

  retry(role: AgentRole, attempt: number, parentEventId?: string): void {
    this.retryCount++;
    console.log(`  ${this._retry} ${this._c(role)} retry #${attempt}`);
    this.emitter?.emit({
      type: "retry",
      timestamp: new Date().toISOString(),
      eventId: generateEventId(),
      runId: this.runId ?? "unknown",
      role,
      attempt,
      parentEventId,
    });
  }

  info(message: string): void {
    console.log(`  ${this._info} ${message}`);
    this.emitter?.emit({
      type: "info",
      timestamp: new Date().toISOString(),
      eventId: generateEventId(),
      runId: this.runId ?? "unknown",
      summary: message,
    });
  }

  /** Emit a run_summary event with aggregate metrics at the end of a CEO run. */
  runSummary(metrics: {
    totalAgents: number;
    succeeded: number;
    failed: number;
    retried: number;
    totalTokens: { input: number; output: number };
    totalDurationMs: number;
  }): void {
    const timestamp = new Date().toISOString();
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  RUN SUMMARY`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  Total Agents: ${metrics.totalAgents}  |  Succeeded: ${metrics.succeeded}  |  Failed: ${metrics.failed}`);
    console.log(`  Retries: ${metrics.retried}  |  Duration: ${(metrics.totalDurationMs / 1000).toFixed(1)}s`);
    console.log(`  Tokens: ${metrics.totalTokens.input.toLocaleString()} in / ${metrics.totalTokens.output.toLocaleString()} out (${(metrics.totalTokens.input + metrics.totalTokens.output).toLocaleString()} total)`);
    console.log(`${"=".repeat(60)}\n`);
    this.emitter?.emit({
      type: "run_summary",
      timestamp,
      eventId: generateEventId(),
      runId: this.runId ?? "unknown",
      summary: `Run complete: ${metrics.succeeded}/${metrics.totalAgents} agents succeeded in ${(metrics.totalDurationMs / 1000).toFixed(1)}s`,
      metrics,
    });
  }

  banner(message: string): void {
    const line = "-".repeat(Math.max(message.length + 4, 50));
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

  private get _arrow() { return "§9B->§r"; }
  private get _check() { return "§9Bv§r"; }
  private get _cross() { return "§C0x§r"; }
  private get _retry() { return "§E3~§r"; }
  private get _info() { return "§888*§r"; }
}

// Simple ANSI color helper -- replaces section-sign codes with ANSI codes
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
    "§89": "\x1b[38;2;200;180;220m",  // periwinkle
    "§67": "\x1b[38;2;90;154;207m",   // slate blue
    "§55": "\x1b[38;2;74;138;191m",   // steel blue
    // Phase 3 -- PM sub-agents
    "§D9": "\x1b[38;2;201;121;237m",  // pink-magenta
    "§B9": "\x1b[38;2;128;201;234m",  // cyan-light
    "§E6": "\x1b[38;2;230;176;70m",   // amber
    "§4A": "\x1b[38;2;64;170;130m",   // teal-green
    "§888": "\x1b[38;2;136;136;136m", // gray
    "§r": "\x1b[0m",                   // reset
  };
  let result = text;
  for (const [code, ansi] of Object.entries(colors)) {
    result = result.replaceAll(code, ansi);
  }
  return result;
}
