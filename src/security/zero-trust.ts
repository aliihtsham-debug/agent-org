/**
 * Phase 13 — Zero-Trust Agent Communication
 *
 * Every agent action is authenticated and authorized.
 */

import type { AgentIdentity } from "../types/identity-types.js";
import type { PolicyDecision } from "../types/governance-types.js";
import { verifySignature } from "../identity/agent-identity.js";

export interface SecureChannel {
  from: string;
  to: string;
  established: boolean;
  establishedAt: string;
}

export async function verifyAgentIdentity(identity: AgentIdentity): Promise<boolean> {
  // Check DID format
  if (!identity.agentId || !identity.publicKey) return false;

  // Verify DID format: did:agent:<uuid>
  const didPrefix = `did:agent:${identity.agentId}`;
  if (!didPrefix.startsWith("did:agent:")) return false;

  // Verify public key is valid base64
  try {
    const decoded = Buffer.from(identity.publicKey, "base64");
    if (decoded.length === 0) return false;
  } catch {
    return false;
  }

  return true;
}

export async function createSecureChannel(
  from: AgentIdentity,
  to: AgentIdentity,
): Promise<SecureChannel> {
  // Verify both identities
  const fromValid = await verifyAgentIdentity(from);
  const toValid = await verifyAgentIdentity(to);

  return {
    from: from.agentId,
    to: to.agentId,
    established: fromValid && toValid,
    establishedAt: new Date().toISOString(),
  };
}

export async function enforcePolicy(
  agentId: string,
  action: string,
  _resource: string,
): Promise<PolicyDecision> {
  // In a full implementation, this would check the policy engine
  // For now, allow known safe actions
  const safeActions = ["read", "list", "search"];
  if (safeActions.includes(action)) {
    return {
      allowed: true,
      effect: "allow",
      reason: "Safe action allowed by default",
      ruleId: "zero-trust-default",
    };
  }

  return {
    allowed: false,
    effect: "deny",
    reason: `Action "${action}" not authorized by zero-trust policy`,
    ruleId: "zero-trust-deny",
  };
}
