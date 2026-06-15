/**
 * Phase 14 — Enterprise Dashboard API Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { resetState, getState, broadcastEvent } from "../src/dashboard/server.js";
import { createApprovalWorkflow } from "../src/approval/approval-workflow.js";
import { AuditLog } from "../src/audit/audit-log.js";

const TEST_AUDIT_DIR = `outputs/.audit-dashboard-test-${Date.now()}`;

describe("Phase 14 — Enterprise Dashboard API", () => {
  beforeEach(async () => {
    process.env.AGENT_ORG_AUDIT_DIR = TEST_AUDIT_DIR;
    await rm(TEST_AUDIT_DIR, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_AUDIT_DIR, { recursive: true });
    resetState();
  });

  afterEach(async () => {
    delete process.env.AGENT_ORG_AUDIT_DIR;
    await rm(TEST_AUDIT_DIR, { recursive: true, force: true }).catch(() => {});
  });

  it("1. GET /api/state returns current state", () => {
    const state = getState();
    expect(state).toBeDefined();
    expect(state.events).toBeDefined();
    expect(state.status).toBe("idle");
    expect(state.metrics).toBeNull();
  });

  it("2. state updates after events", () => {
    broadcastEvent({
      type: "spawn",
      timestamp: new Date().toISOString(),
      eventId: "test-1",
      runId: "run-1",
      role: "ceo",
    });

    const state = getState();
    expect(state.events.length).toBe(1);
    expect(state.status).toBe("running");
  });

  it("3. approval workflow creates pending requests", () => {
    const workflow = createApprovalWorkflow();
    workflow.createApprovalRequest({
      stageId: "review",
      title: "Test approval",
      description: "Test",
      requestedBy: "ceo",
      riskLevel: "medium",
      context: { agentOutputs: [], summary: "Test", riskAssessment: "low" },
      options: [],
      timeoutMs: 300000,
    });

    const pending = workflow.getPendingRequests();
    expect(pending.length).toBe(1);
    expect(pending[0].title).toBe("Test approval");
  });

  it("4. audit log entries are retrievable", async () => {
    const log = new AuditLog();
    await log.appendEntry({
      agentDid: "did:agent:ceo",
      action: "agent_spawn",
      inputHash: "a",
      outputHash: "b",
      inputRef: "idea",
      outputRef: "output",
      timestamp: new Date().toISOString(),
      eventId: "e1",
      signature: "s1",
    });

    const entries = await log.getEntries();
    expect(entries.length).toBe(1);
  });

  it("5. state includes enterprise metrics", () => {
    // broadcastEvent already imported at top
    broadcastEvent({
      type: "run_summary",
      timestamp: new Date().toISOString(),
      eventId: "summary-1",
      runId: "run-1",
      metrics: {
        totalAgents: 10,
        succeeded: 8,
        failed: 2,
        retried: 1,
        totalTokens: { input: 50000, output: 100000 },
        totalDurationMs: 60000,
      },
    });

    const state = getState();
    expect(state.metrics).not.toBeNull();
    expect(state.metrics!.totalAgents).toBe(10);
    expect(state.metrics!.succeeded).toBe(8);
  });

  it("6. state returns copy (immutable)", () => {
    const state1 = getState();
    const state2 = getState();
    expect(state1).not.toBe(state2); // Different object references
    expect(state1.events).not.toBe(state2.events);
  });

  it("7. resetState clears all state", () => {
    // broadcastEvent already imported at top
    broadcastEvent({
      type: "spawn",
      timestamp: new Date().toISOString(),
      eventId: "test-1",
      runId: "run-1",
      role: "ceo",
    });

    resetState();
    const state = getState();
    expect(state.events.length).toBe(0);
    expect(state.status).toBe("idle");
  });

  it("8. approval response submission", () => {
    const workflow = createApprovalWorkflow();
    const request = workflow.createApprovalRequest({
      stageId: "review",
      title: "Test",
      description: "Test",
      requestedBy: "ceo",
      riskLevel: "medium",
      context: { agentOutputs: [], summary: "Test", riskAssessment: "low" },
      options: [],
      timeoutMs: 300000,
    });

    const result = workflow.submitResponse({
      requestId: request.id,
      decision: "approve",
      decidedBy: "human",
      decidedAt: new Date().toISOString(),
    });

    expect(result.status).toBe("approved");
  });
});
