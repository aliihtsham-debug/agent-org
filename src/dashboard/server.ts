import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentEvent } from "../observability/events.js";

export type DashboardStatus = "idle" | "running" | "waiting_approval" | "complete" | "failed";

export interface DashboardState {
  events: AgentEvent[];
  status: DashboardStatus;
  startTime: string | null;
}

const state: DashboardState = {
  events: [],
  status: "idle",
  startTime: null,
};

const sseClients: Set<ServerResponse> = new Set();

/** Push a single event to all connected SSE clients and update state. */
export function broadcastEvent(event: AgentEvent): void {
  state.events.push(event);
  if (state.startTime === null) state.startTime = event.timestamp;

  if (event.type === "gate") state.status = "waiting_approval";
  if (event.type === "complete" && event.role === "ceo") state.status = "complete";
  if (event.type === "fail" && event.role === "ceo") state.status = "failed";

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

/** Get a snapshot of the current state (for initial page load). */
export function getState(): DashboardState {
  return { ...state, events: [...state.events] };
}

/**
 * Start the dashboard HTTP server.
 * Serves:
 *   GET /events  — SSE stream of agent events
 *   GET /api/state — current run state as JSON
 *   GET /         — dashboard HTML
 */
export function startDashboardServer(port = 3001): ReturnType<typeof createServer> {
  const htmlPath = join(__dirname, "index.html");

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost`);

    // SSE endpoint
    if (url.pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
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

    // Serve dashboard HTML
    if (existsSync(htmlPath)) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(readFileSync(htmlPath));
    } else {
      res.writeHead(404);
      res.end("Dashboard HTML not found.");
    }
  });

  server.listen(port, () => {
    console.log(`\n  \x1b[38;2;56;189;246mDashboard running at http://localhost:${port}\x1b[0m\n`);
  });

  return server;
}
