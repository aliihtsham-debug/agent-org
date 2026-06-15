// ── Phase 10 — Decision Provenance Tracker ─────────────────────────────
//
// Tracks the full chain from idea to agent output,
// recording every delegation and decision along the way.

import type { DecisionProvenance, ProvenanceStep } from "../types/audit-types.js";

export class ProvenanceTracker {
  private decisions: Map<string, DecisionProvenance> = new Map();
  private decisionOrder: string[] = [];

  /**
   * Record a delegation from one agent to another.
   * Associates with the most recently tracked decision.
   */
  trackDelegation(
    from: string,
    to: string,
    action: string,
    inputRef: string,
  ): void {
    const decisionId = this.getLatestDecisionId();
    if (!decisionId) return;

    const step: ProvenanceStep = {
      timestamp: new Date().toISOString(),
      from,
      to,
      action,
      inputSummary: inputRef,
      outputSummary: "",
      signature: "",
    };

    const decision = this.decisions.get(decisionId)!;
    decision.delegations.push(step);
    decision.timeline.push(step);
  }

  /**
   * Initialize tracking for a new decision.
   */
  trackDecision(decisionId: string, idea: string): void {
    this.decisions.set(decisionId, {
      decisionId,
      idea,
      delegations: [],
      inputs: [],
      outputs: [],
      timeline: [],
    });
    this.decisionOrder.push(decisionId);
  }

  /**
   * Record an output produced by an agent, linked to its input references.
   * Associates with the most recently tracked decision.
   */
  trackOutput(
    agentId: string,
    outputRef: string,
    inputRefs: string[],
  ): void {
    const decisionId = this.getLatestDecisionId();
    if (!decisionId) return;

    const decision = this.decisions.get(decisionId)!;
    decision.outputs.push(outputRef);
    decision.inputs.push(...inputRefs);

    decision.timeline.push({
      timestamp: new Date().toISOString(),
      from: agentId,
      action: "output",
      inputSummary: inputRefs.join(", "),
      outputSummary: outputRef,
      signature: "",
    });
  }

  /**
   * Retrieve the provenance record for a specific decision.
   */
  getProvenance(decisionId: string): DecisionProvenance {
    const decision = this.decisions.get(decisionId);
    if (!decision) {
      return {
        decisionId,
        idea: "",
        delegations: [],
        inputs: [],
        outputs: [],
        timeline: [],
      };
    }
    return decision;
  }

  /**
   * Retrieve all tracked provenance records.
   */
  getAllProvenance(): DecisionProvenance[] {
    return this.decisionOrder.map((id) => this.decisions.get(id)!);
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  private getLatestDecisionId(): string | undefined {
    if (this.decisionOrder.length === 0) return undefined;
    return this.decisionOrder[this.decisionOrder.length - 1];
  }
}
