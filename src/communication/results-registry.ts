import type { AgentRole, AgentResult } from "../types/agent-types.js";

/**
 * Shared in-memory results registry for direct agent-to-agent result access.
 *
 * Before Phase 5, the only way for Agent A's output to reach Agent B was
 * through the filesystem (write to disk → read from disk → truncate to 2000 chars).
 * The registry eliminates this round-trip: agents publish results after completion,
 * and other agents can read them directly.
 *
 * Usage:
 *   const registry = new AgentResultsRegistry();
 *   registry.publish(result);              // after an agent completes
 *   registry.get("frontend-engineer");     // full AgentResult | undefined
 *   registry.getSummary("cto");            // full summary string | ""
 *
 * The registry is synchronous — results are always published after `Promise.all()`
 * resolves and read before the next wave starts. No concurrent read/write hazard.
 *
 * Disk writes are preserved as the durable audit trail. The registry is purely
 * an in-memory optimization layered on top.
 */
export class AgentResultsRegistry {
  private results: Map<AgentRole, AgentResult> = new Map();

  /** Publish a result so other agents can access it. */
  publish(result: AgentResult): void {
    this.results.set(result.role, result);
  }

  /** Get the full result for a role. */
  get(role: AgentRole): AgentResult | undefined {
    return this.results.get(role);
  }

  /** Get the summary string for a role. Optionally truncate to maxLength. */
  getSummary(role: AgentRole, maxLength?: number): string {
    const result = this.results.get(role);
    if (!result) return "";
    const text = result.summary;
    if (maxLength != null && text.length > maxLength) {
      return text.slice(0, maxLength);
    }
    return text;
  }

  /** Check whether a result has been published for a role. */
  has(role: AgentRole): boolean {
    return this.results.has(role);
  }

  /** Get a snapshot of all published results. */
  getAll(): ReadonlyMap<AgentRole, AgentResult> {
    return new Map(this.results);
  }

  /** Clear all results (useful for testing). */
  clear(): void {
    this.results.clear();
  }
}
