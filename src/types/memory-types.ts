/**
 * Phase 12 — Multi-Agent Operating System
 *
 * Persistent agent memory, reputation scoring, cross-project knowledge.
 */

export interface AgentMemory {
  agentId: string;
  agentDid: string;
  entries: MemoryEntry[];
  summary: string;
  lastUpdated: string;
  version: number;
}

export interface MemoryEntry {
  timestamp: string;
  projectId: string;
  type: "lesson" | "pattern" | "feedback" | "outcome";
  content: string;
  importance: number; // 0-1
  tags: string[];
}

export interface AgentReputation {
  agentId: string;
  overall: number; // 0-100 composite
  quality: number; // Based on refinement acceptance rate
  reliability: number; // Based on completion vs failure rate
  collaboration: number; // Based on cross-functional review feedback
  history: ReputationEvent[];
  lastUpdated: string;
}

export interface ReputationEvent {
  timestamp: string;
  projectId: string;
  event: "critique_received" | "critique_accepted" | "review_given" | "completion" | "failure";
  delta: number;
  details: string;
}

export interface OrganizationalKnowledge {
  entries: KnowledgeEntry[];
  lastUpdated: string;
}

export interface KnowledgeEntry {
  id: string;
  projectId: string;
  timestamp: string;
  type: "pattern" | "lesson" | "decision" | "anti_pattern";
  content: string;
  relevance: string[];
  sourceAgents: string[];
}

export interface WorkflowCheckpoint {
  workflowId: string;
  timestamp: string;
  state: Record<string, unknown>;
  completedSteps: string[];
  pendingSteps: string[];
}
