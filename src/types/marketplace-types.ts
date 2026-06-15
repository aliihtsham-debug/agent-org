/**
 * Phase 16 — AI Organization Marketplace
 *
 * Reusable organizational blueprints, industry-specific agent packs.
 */

import type { AgentRole } from "./agent-types.js";

export interface OrganizationalBlueprint {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  license: string;
  agentRoles: BlueprintAgentRole[];
  governanceTemplate: string;
  metadata: BlueprintMetadata;
}

export interface BlueprintAgentRole {
  role: AgentRole;
  systemPromptOverride?: string;
  maxTokens?: number;
  tools?: string[];
}

export interface BlueprintMetadata {
  tags: string[];
  category: string;
  rating: number;
  downloads: number;
}

export interface AgentPack {
  id: string;
  name: string;
  description: string;
  blueprints: string[];
  tags: string[];
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  tags: string[];
}

export interface WorkflowStep {
  order: number;
  name: string;
  agentRole: AgentRole;
  description: string;
}
