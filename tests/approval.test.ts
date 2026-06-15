/**
 * Phase 11 — Human-in-the-Loop Enterprise Control Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ApprovalWorkflow, createApprovalWorkflow } from "../src/approval/approval-workflow.js";
import { evaluateEscalation, escalate } from "../src/approval/risk-escalation.js";
import { OverrideController, registerOverrideHandler, interruptAgent, isAgentAborted } from "../src/approval/human-override.js";
import type { AgentResult } from "../src/types/agent-types.js";

function makeResult(role: string, status: AgentResult["status"] = "completed"): AgentResult {
  return {
    role: role as AgentResult["role"],
    status,
    outputPath: `outputs/${role}`,
    summary: `${role} summary`,
    artifacts: [],
    tokenUsage: { input: 100, output: 200 },
    durationMs: 1000,
  };
}

describe("Phase 11 — Human-in-the-Loop Enterprise Control", () => {
  describe("Approval Workflow", () => {
    it("1. single-stage approval (approve)", () => {
      const workflow = createApprovalWorkflow();
      const request = workflow.createApprovalRequest({
        stageId: "review",
        title: "Approve deployment",
        description: "Review agent outputs before deployment",
        requestedBy: "ceo",
        riskLevel: "medium",
        context: { agentOutputs: [], summary: "Ready", riskAssessment: "low" },
        options: [
          { decision: "approve", label: "Approve", requiresComment: false },
          { decision: "reject", label: "Reject", requiresComment: false },
        ],
        timeoutMs: 300000,
      });

      expect(request.id).toBeDefined();
      expect(request.requestedBy).toBe("ceo");

      const result = workflow.submitResponse({
        requestId: request.id,
        decision: "approve",
        decidedBy: "human",
        decidedAt: new Date().toISOString(),
      });

      expect(result.status).toBe("approved");
    });

    it("2. single-stage approval (reject)", () => {
      const workflow = createApprovalWorkflow();
      const request = workflow.createApprovalRequest({
        stageId: "review",
        title: "Approve deployment",
        description: "Review",
        requestedBy: "ceo",
        riskLevel: "medium",
        context: { agentOutputs: [], summary: "Ready", riskAssessment: "low" },
        options: [],
        timeoutMs: 300000,
      });

      const result = workflow.submitResponse({
        requestId: request.id,
        decision: "reject",
        decidedBy: "human",
        decidedAt: new Date().toISOString(),
      });

      expect(result.status).toBe("rejected");
    });

    it("3. multi-stage approval pipeline", () => {
      const workflow = createApprovalWorkflow();
      const multi = workflow.createMultiStageApproval([
        { name: "Review", approvers: ["ceo"], minApprovals: 1, timeoutMs: 300000 },
        { name: "Approve", approvers: ["ceo", "cto"], minApprovals: 2, timeoutMs: 600000 },
        { name: "Deploy", approvers: ["devops-agent"], minApprovals: 1, timeoutMs: 300000 },
      ]);

      expect(multi.stages.length).toBe(3);
      expect(multi.currentStage).toBe(0);
      expect(multi.status).toBe("pending");

      const advanced = workflow.advanceStage(multi);
      expect(advanced.currentStage).toBe(1);

      // Advance through all stages
      const final = workflow.advanceStage(workflow.advanceStage(advanced));
      expect(final.status).toBe("approved");
    });

    it("4. approval timeout detection", () => {
      const workflow = createApprovalWorkflow();
      const request = workflow.createApprovalRequest({
        stageId: "review",
        title: "Urgent approval",
        description: "Time-sensitive",
        requestedBy: "ceo",
        riskLevel: "high",
        context: { agentOutputs: [], summary: "Urgent", riskAssessment: "high" },
        options: [],
        timeoutMs: 0, // Immediate timeout
      });

      // Should timeout immediately
      expect(workflow.checkTimeout(request)).toBe(true);
    });

    it("5. risk escalation on multiple failures", () => {
      const results: AgentResult[] = [
        makeResult("ceo", "completed"),
        makeResult("pm", "failed"),
        makeResult("cto", "failed"),
        makeResult("ciso", "failed"),
      ];

      const rules = [
        { trigger: "reject" as const, escalateTo: "ceo", notifyChannels: ["dashboard"], timeoutMs: 0 },
      ];

      const escalation = evaluateEscalation(results, "medium", rules);
      expect(escalation).not.toBeNull();
      expect(escalation!.triggered).toBe(true);
      expect(escalation!.target).toBe("ceo");
    });

    it("6. approval with conditions parsing", () => {
      const workflow = createApprovalWorkflow();
      const request = workflow.createApprovalRequest({
        stageId: "review",
        title: "Approve with conditions",
        description: "Requires modifications",
        requestedBy: "ceo",
        riskLevel: "medium",
        context: { agentOutputs: [], summary: "Conditional", riskAssessment: "low" },
        options: [
          {
            decision: "approve_with_conditions",
            label: "Approve with conditions",
            requiresComment: true,
            conditions: ["Fix security issues", "Add tests"],
          },
        ],
        timeoutMs: 300000,
      });

      const result = workflow.submitResponse({
        requestId: request.id,
        decision: "approve_with_conditions",
        decidedBy: "human",
        decidedAt: new Date().toISOString(),
        comment: "Please address findings",
        conditions: ["Fix security issues"],
      });

      expect(result.status).toBe("approved");
    });

    it("7. human override interruption", () => {
      const controller = new OverrideController();
      expect(controller.isAborted()).toBe(false);

      controller.abort();
      expect(controller.isAborted()).toBe(true);
    });

    it("8. workflow state transitions", () => {
      const workflow = createApprovalWorkflow();
      const request = workflow.createApprovalRequest({
        stageId: "review",
        title: "State test",
        description: "Testing state transitions",
        requestedBy: "ceo",
        riskLevel: "low",
        context: { agentOutputs: [], summary: "Test", riskAssessment: "low" },
        options: [],
        timeoutMs: 300000,
      });

      // Initial state — pending
      const pending = workflow.getPendingRequests();
      expect(pending.length).toBeGreaterThan(0);

      // Defer — still pending
      workflow.submitResponse({
        requestId: request.id,
        decision: "defer",
        decidedBy: "human",
        decidedAt: new Date().toISOString(),
      });

      const stillPending = workflow.getPendingRequests();
      expect(stillPending.length).toBeGreaterThan(0);

      // Escalate
      const escalated = workflow.submitResponse({
        requestId: request.id,
        decision: "escalate",
        decidedBy: "human",
        decidedAt: new Date().toISOString(),
      });
      expect(escalated.status).toBe("escalated");
    });

    it("9. escalation rules evaluation", () => {
      const rules = [
        { trigger: "timeout" as const, escalateTo: "ceo", notifyChannels: ["dashboard"], timeoutMs: 100 },
        { trigger: "risk_threshold" as const, escalateTo: "ciso", notifyChannels: ["dashboard"], timeoutMs: 0 },
        { trigger: "reject" as const, escalateTo: "ceo", notifyChannels: ["dashboard"], timeoutMs: 0 },
      ];

      // Critical risk should trigger escalation
      const criticalEscalation = evaluateEscalation([], "critical", rules);
      expect(criticalEscalation).not.toBeNull();
      expect(criticalEscalation!.target).toBe("ciso");

      // Low risk should not trigger
      const lowEscalation = evaluateEscalation([], "low", rules);
      expect(lowEscalation).toBeNull();
    });
  });
});
