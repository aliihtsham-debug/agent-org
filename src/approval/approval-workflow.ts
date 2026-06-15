/**
 * Phase 11 — Multi-Stage Approval Workflow
 */

import type {
  ApprovalRequest,
  ApprovalResponse,
  ApprovalStage,
  ApprovalStageConfig,
  MultiStageApproval,
} from "../types/approval-types.js";

function generateId(): string {
  try {
    return `apr_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    return `apr_${Date.now()}`;
  }
}

export class ApprovalWorkflow {
  private requests: Map<string, ApprovalRequest> = new Map();
  private responses: Map<string, ApprovalResponse[]> = new Map();

  createApprovalRequest(
    request: Omit<ApprovalRequest, "id" | "requestedAt">,
  ): ApprovalRequest {
    const id = generateId();
    const full: ApprovalRequest = {
      ...request,
      id,
      requestedAt: new Date().toISOString(),
    };
    this.requests.set(id, full);
    this.responses.set(id, []);
    return full;
  }

  submitResponse(response: ApprovalResponse): { status: ApprovalStage; nextStage?: string } {
    const existing = this.responses.get(response.requestId) ?? [];
    existing.push(response);
    this.responses.set(response.requestId, existing);

    const request = this.requests.get(response.requestId);
    if (!request) return { status: "rejected" };

    switch (response.decision) {
      case "approve":
        return { status: "approved" };
      case "approve_with_conditions":
        return { status: "approved" };
      case "reject":
        return { status: "rejected" };
      case "escalate":
        return { status: "escalated" };
      case "defer":
        return { status: "pending" };
      default:
        return { status: "pending" };
    }
  }

  checkTimeout(request: ApprovalRequest): boolean {
    const elapsed = Date.now() - new Date(request.requestedAt).getTime();
    return elapsed >= request.timeoutMs;
  }

  getPendingRequests(): ApprovalRequest[] {
    const pending: ApprovalRequest[] = [];
    for (const [id, request] of this.requests) {
      const resps = this.responses.get(id) ?? [];
      const latestDecision = resps.length > 0 ? resps[resps.length - 1].decision : null;
      if (!latestDecision || latestDecision === "defer") {
        pending.push(request);
      }
    }
    return pending;
  }

  createMultiStageApproval(stages: ApprovalStageConfig[]): MultiStageApproval {
    return {
      stages,
      currentStage: 0,
      status: "pending",
    };
  }

  advanceStage(approval: MultiStageApproval): MultiStageApproval {
    const nextStage = approval.currentStage + 1;
    if (nextStage >= approval.stages.length) {
      return { ...approval, status: "approved" };
    }
    return { ...approval, currentStage: nextStage };
  }
}

export function createApprovalWorkflow(): ApprovalWorkflow {
  return new ApprovalWorkflow();
}
