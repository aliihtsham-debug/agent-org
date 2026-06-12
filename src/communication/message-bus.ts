import type { AgentRole } from "../types/agent-types.js";

/**
 * Direct agent-to-agent message.
 *
 * Unlike `AgentEvent` (which broadcasts lifecycle events to all subscribers like
 * the dashboard and structured log), messages are targeted: sent from one agent
 * to another with a specific payload.
 */
export interface AgentMessage {
  type: "message";
  timestamp: string;
  from: AgentRole;
  to: AgentRole;
  payload: string;
}

export type MessageHandler = (message: AgentMessage) => void;

/**
 * Lightweight message bus for direct agent-to-agent communication.
 *
 * - `subscribe(to, handler)` — register a handler for messages addressed to a role.
 *   Returns an unsubscribe function.
 * - `send(message)` — deliver a message to the target role's subscribers.
 * - Zero dependencies. Synchronous delivery.
 *
 * This is separate from `AgentEventEmitter`, which broadcasts lifecycle events
 * (spawn, complete, fail, gate) indiscriminately to all subscribers. The message
 * bus delivers targeted payloads — only agents subscribed to the recipient role
 * receive the message.
 *
 * Usage:
 *   const bus = new AgentMessageBus();
 *   bus.subscribe("security-auditor", (msg) => {
 *     console.log(`Security Auditor received: ${msg.payload}`);
 *   });
 *   bus.send({ type: "message", from: "cto", to: "security-auditor", payload: "..." });
 */
export class AgentMessageBus {
  private subscribers: Map<AgentRole, Set<MessageHandler>> = new Map();

  /**
   * Subscribe to messages addressed to a specific role.
   * Returns an unsubscribe function.
   */
  subscribe(to: AgentRole, handler: MessageHandler): () => void {
    let handlers = this.subscribers.get(to);
    if (!handlers) {
      handlers = new Set();
      this.subscribers.set(to, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers?.delete(handler);
      if (handlers?.size === 0) {
        this.subscribers.delete(to);
      }
    };
  }

  /**
   * Send a message to the target role's subscribers.
   * If no subscribers exist, the message is silently dropped.
   */
  send(message: AgentMessage): void {
    const handlers = this.subscribers.get(message.to);
    if (handlers) {
      for (const handler of handlers) {
        handler(message);
      }
    }
  }
}
