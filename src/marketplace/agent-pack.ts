/**
 * Phase 16 — Pre-Built Agent Packs
 */

import type { AgentPack } from "../types/marketplace-types.js";

export const STARTUP_CTO_PACK: AgentPack = {
  id: "startup-cto",
  name: "Startup CTO Pack",
  description: "Minimal engineering team: CTO + Frontend + Backend + DevOps",
  blueprints: ["minimal-eng-team"],
  tags: ["startup", "engineering", "minimal"],
};

export const SECURITY_FIRST_PACK: AgentPack = {
  id: "security-first",
  name: "Security-First Organization",
  description: "CISO-heavy organization with extra security ICs",
  blueprints: ["security-heavy-org"],
  tags: ["security", "compliance", "enterprise"],
};

export const COMPLIANCE_HEAVY_PACK: AgentPack = {
  id: "compliance-heavy",
  name: "Compliance-Heavy Organization",
  description: "Full compliance team with audit and governance",
  blueprints: ["compliance-org"],
  tags: ["compliance", "audit", "enterprise"],
};

export const FULL_STACK_SMALL_PACK: AgentPack = {
  id: "full-stack-small",
  name: "Full-Stack Small Team",
  description: "Complete small team: PM + CTO + Eng Manager + 4 ICs",
  blueprints: ["full-stack-small"],
  tags: ["startup", "full-stack", "small-team"],
};

export const AGENT_PACKS: AgentPack[] = [
  STARTUP_CTO_PACK,
  SECURITY_FIRST_PACK,
  COMPLIANCE_HEAVY_PACK,
  FULL_STACK_SMALL_PACK,
];
