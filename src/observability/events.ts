export type AgentEventType =
  | "spawn"
  | "complete"
  | "fail"
  | "retry"
  | "info"
  | "gate"
  | "artifact"
  // Phase 6 — Refinement
  | "review"
  | "refine"
  // Phase 12 — Observability
  | "run_summary";

export interface AgentEvent {
  type: AgentEventType;
  timestamp: string;
  /** Unique ID for this event (UUID v4) — enables deduplication and correlation */
  eventId: string;
  /** ID of the parent event that triggered this one (e.g., spawn -> complete chain) */
  parentEventId?: string;
  /** Run-level correlation ID — shared by all events in a single CEO execution */
  runId: string;
  from?: string;
  to?: string;
  role?: string;
  summary?: string;
  error?: string;
  /** Classification of the error for targeted debugging */
  errorType?: "timeout" | "rate_limit" | "server" | "auth" | "unknown";
  /** The operation that was being attempted when the error occurred (e.g., "LLM call", "git commit", "artifact write") */
  operation?: string;
  attempt?: number;
  artifactPath?: string;
  sizeBytes?: number;
  /** Aggregate metrics — only present on run_summary events */
  metrics?: RunMetrics;
}

/** Aggregate metrics emitted at the end of a run via the run_summary event. */
export interface RunMetrics {
  totalAgents: number;
  succeeded: number;
  failed: number;
  retried: number;
  totalTokens: { input: number; output: number };
  totalDurationMs: number;
}

export type EventHandler = (event: AgentEvent) => void;

/**
 * Generate a unique event ID using crypto.randomUUID if available,
 * otherwise fallback to a timestamp-based ID.
 */
export function generateEventId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Fallback for environments without crypto.randomUUID
    return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Generate a unique run ID. All events in a single CEO execution share this ID.
 */
export function generateRunId(): string {
  try {
    return `run_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

/**
 * Lightweight event emitter for agent lifecycle events.
 *
 * - `subscribe(handler)` returns an unsubscribe function.
 * - `emit(event)` synchronously notifies all subscribers.
 * - Zero dependencies.
 */
export class AgentEventEmitter {
  private handlers: Set<EventHandler> = new Set();

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  emit(event: AgentEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        // Isolate subscriber failures so one bad handler doesn't break the event pipeline
        console.error("[AgentEventEmitter] subscriber error:", err);
      }
    }
  }
}
