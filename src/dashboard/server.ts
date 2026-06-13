import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "../observability/events.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export type DashboardStatus = "idle" | "running" | "waiting_approval" | "complete" | "failed";

export interface DashboardState {
  events: AgentEvent[];
  status: DashboardStatus;
  startTime: string | null;
  /** Aggregate metrics from the most recent run_summary event (Phase 12) */
  metrics: RunMetrics | null;
}

/** Aggregate metrics structure (mirrors events.ts RunMetrics) */
export interface RunMetrics {
  totalAgents: number;
  succeeded: number;
  failed: number;
  retried: number;
  totalTokens: { input: number; output: number };
  totalDurationMs: number;
}

const state: DashboardState = {
  events: [],
  status: "idle",
  startTime: null,
  metrics: null,
};

const sseClients: Set<ServerResponse> = new Set();

// Cap dashboard event buffer to prevent unbounded memory growth during long runs.
// At ~1KB per event, 1000 events ~= 1MB. Configurable via DASHBOARD_MAX_EVENTS env var.
const MAX_EVENTS = parseInt(process.env.DASHBOARD_MAX_EVENTS ?? "1000", 10);

/** Push a single event to all connected SSE clients and update state. */
export function broadcastEvent(event: AgentEvent): void {
  state.events.push(event);
  // Evict oldest events when buffer exceeds the cap.
  // This bounds dashboard memory usage while preserving recent history.
  if (state.events.length > MAX_EVENTS) {
    state.events.splice(0, state.events.length - MAX_EVENTS);
  }
  if (state.startTime === null) state.startTime = event.timestamp;

  if (event.type === "gate") state.status = "waiting_approval";
  if (event.type === "complete" && event.role === "ceo") state.status = "complete";
  if (event.type === "fail" && event.role === "ceo") state.status = "failed";
  // Phase 12: capture run summary metrics into dashboard state
  if (event.type === "run_summary" && event.metrics) {
    state.metrics = event.metrics;
    state.status = "complete";
  }

  const data = JSON.stringify(event);
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      // Client disconnected
    }
  }
}

/** Update the dashboard status and notify clients. */
export function updateStatus(status: DashboardStatus): void {
  state.status = status;
  for (const client of sseClients) {
    try {
      client.write(`event: status\ndata: ${JSON.stringify({ status })}\n\n`);
    } catch {
      // Client disconnected
    }
  }
}

/** Get a snapshot of the current state (for initial page load).
 * Returns a copy to prevent external mutation of internal state. */
export function getState(): DashboardState {
  return { ...state, events: [...state.events] };
}

/** Disconnect all SSE clients and reset state (useful for testing / restart). */
export function resetState(): void {
  state.events = [];
  state.status = "idle";
  state.startTime = null;
  state.metrics = null;
  for (const client of sseClients) {
    try {
      client.end();
    } catch {
      // Client already closed
    }
  }
  sseClients.clear();
}

/**
 * Start the dashboard HTTP server.
 * Serves:
 *   GET /events  — SSE stream of agent events
 *   GET /api/state — current run state as JSON
 *   GET /         — dashboard HTML
 *
 * Security: binds to 127.0.0.1 by default. Optional token auth via
 * DASHBOARD_TOKEN env variable or the token parameter.
 */
export function startDashboardServer(
  port = 3001,
  token?: string,
): ReturnType<typeof createServer> {
  const htmlPath = join(__dirname, "index.html");
  const authToken = token ?? process.env.DASHBOARD_TOKEN ?? null;

  const isAuthorized = (req: IncomingMessage): boolean => {
    if (!authToken) return true;
    const url = new URL(req.url ?? "/", "http://localhost");
    const queryToken = url.searchParams.get("token");
    const bearer = req.headers.authorization ?? "";
    return queryToken === authToken || bearer === `Bearer ${authToken}`;
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost`);

    // Authorization check
    if (authToken && !isAuthorized(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    // SSE endpoint
    if (url.pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // Send current state on connect
      res.write(`event: connected\ndata: ${JSON.stringify(getState())}\n\n`);
      sseClients.add(res);

      // Heartbeat every 15s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          res.write(": heartbeat\n\n");
        } catch {
          clearInterval(heartbeat);
          sseClients.delete(res);
        }
      }, 15000);

      req.on("close", () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
      });

      return;
    }

    // API state endpoint
    if (url.pathname === "/api/state") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(getState()));
      return;
    }

    // Health check endpoint (Phase 12)
    if (url.pathname === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        dashboard: state.status,
        uptime: process.uptime(),
        eventCount: state.events.length,
        lastEventAt: state.events.length > 0 ? state.events[state.events.length - 1].timestamp : null,
        metrics: state.metrics,
      }));
      return;
    }

    // Serve dashboard HTML
    if (existsSync(htmlPath)) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(readFileSync(htmlPath));
    } else {
      res.writeHead(404);
      res.end("Dashboard HTML not found.");
    }
  });

  server.listen(port, "127.0.0.1", () => {
    const tokenHint = authToken ? " (token auth enabled)" : "";
    console.log(`\n  \x1b[38;2;56;189;246mDashboard running at http://127.0.0.1:${port}${tokenHint}\x1b[0m\n`);
  });

  return server;
}
