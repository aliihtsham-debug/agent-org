/**
 * Phase 11 — Human Override System
 *
 * Allows humans to interrupt agents at any point.
 * Uses AbortController pattern for clean interruption.
 */

type OverrideHandler = (agentId: string, reason: string) => void;

const overrideHandlers: OverrideHandler[] = [];
const abortedAgents: Set<string> = new Set();
const abortControllers: Map<string, AbortController> = new Map();

export function registerOverrideHandler(handler: OverrideHandler): () => void {
  overrideHandlers.push(handler);
  return () => {
    const idx = overrideHandlers.indexOf(handler);
    if (idx !== -1) overrideHandlers.splice(idx, 1);
  };
}

export function requestOverride(
  agentId: string,
  reason: string,
): { approved: boolean; timestamp: string } {
  for (const handler of overrideHandlers) {
    handler(agentId, reason);
  }
  return { approved: true, timestamp: new Date().toISOString() };
}

export function interruptAgent(agentId: string): void {
  abortedAgents.add(agentId);
  const controller = abortControllers.get(agentId);
  if (controller) {
    controller.abort();
  }
}

export function isAgentAborted(agentId: string): boolean {
  return abortedAgents.has(agentId);
}

export function createAbortController(agentId: string): AbortController {
  const controller = new AbortController();
  abortControllers.set(agentId, controller);
  return controller;
}

export function clearAbort(agentId: string): void {
  abortedAgents.delete(agentId);
  abortControllers.delete(agentId);
}

export class OverrideController {
  private _aborted = false;

  abort(): void {
    this._aborted = true;
  }

  isAborted(): boolean {
    return this._aborted;
  }
}
