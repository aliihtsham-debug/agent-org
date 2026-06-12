export type AgentEventType =
  | "spawn"
  | "complete"
  | "fail"
  | "retry"
  | "info"
  | "gate"
  | "artifact";

export interface AgentEvent {
  type: AgentEventType;
  timestamp: string;
  from?: string;
  to?: string;
  role?: string;
  summary?: string;
  error?: string;
  attempt?: number;
  artifactPath?: string;
  sizeBytes?: number;
}

export type EventHandler = (event: AgentEvent) => void;

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
      handler(event);
    }
  }
}
