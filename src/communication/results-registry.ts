import type { AgentRole, AgentResult } from "../types/agent-types.js";
import { ROLE_OUTPUT_DIR } from "../types/agent-types.js";

/** All valid agent roles — derived from ROLE_OUTPUT_DIR keys to avoid manual maintenance. */
const VALID_ROLES: ReadonlySet<string> = new Set<AgentRole>(Object.keys(ROLE_OUTPUT_DIR) as AgentRole[]);

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
 *
 * SECURITY: publish() validates that the role is a known agent role and that
 * the result object is well-formed. This prevents registry poisoning where a
 * compromised or manipulated agent could inject entries under arbitrary keys
 * (e.g., overwriting another agent's results or injecting fake roles).
 */
export class AgentResultsRegistry {
  private results: Map<AgentRole, AgentResult> = new Map();

  /**
   * Publish a result so other agents can access it.
   *
   * SECURITY: Validates the result before accepting it:
   * - Role must be a known AgentRole (prevents arbitrary key injection)
   * - Role must be a non-empty string
   * - Result must have required fields (status, summary, artifacts, tokenUsage)
   * - Summary length is capped to prevent memory exhaustion
   *
   * @throws Error if the result fails validation (fail-closed)
   */
  publish(result: AgentResult): void {
    // Validate role is a known agent role — prevents registry poisoning via
    // arbitrary role keys that downstream agents might trust
    if (!result.role || typeof result.role !== "string") {
      throw new Error("Registry publish rejected: missing or invalid role");
    }
    if (!VALID_ROLES.has(result.role)) {
      throw new Error(`Registry publish rejected: unknown role "${result.role}"`);
    }

    // Validate required fields exist — prevents partial/corrupt entries
    if (!result.status || typeof result.status !== "string") {
      throw new Error(`Registry publish rejected for "${result.role}": missing status`);
    }
    if (typeof result.summary !== "string") {
      throw new Error(`Registry publish rejected for "${result.role}": missing summary`);
    }
    if (!Array.isArray(result.artifacts)) {
      throw new Error(`Registry publish rejected for "${result.role}": missing artifacts array`);
    }
    if (!result.tokenUsage || typeof result.tokenUsage.input !== "number" || typeof result.tokenUsage.output !== "number") {
      throw new Error(`Registry publish rejected for "${result.role}": missing tokenUsage`);
    }

    // Cap summary length to prevent memory exhaustion via oversized entries
    const MAX_SUMMARY_LENGTH = 100_000;
    if (result.summary.length > MAX_SUMMARY_LENGTH) {
      result.summary = result.summary.slice(0, MAX_SUMMARY_LENGTH) + "\n...[truncated by registry]";

    }

    // Validate artifact paths: reject path traversal attempts
    for (const artifact of result.artifacts) {
      if (artifact.includes("..") || artifact.startsWith("/") || artifact.startsWith("\\")) {
        throw new Error(`Registry publish rejected for "${result.role}": suspicious artifact path "${artifact}"`);
      }
    }

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

  /** Get a snapshot of all published results.
   * Returns a shallow copy to prevent external mutation of the internal map.
   * For read-only iteration without copying, use `entries()`. */
  getAll(): ReadonlyMap<AgentRole, AgentResult> {
    return new Map(this.results);
  }

  /** Iterate over all results without copying (zero-allocation). */
  entries(): IterableIterator<[AgentRole, AgentResult]> {
    return this.results.entries();
  }

  /** Clear all results (useful for testing). */
  clear(): void {
    this.results.clear();
  }
}
