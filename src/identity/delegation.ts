// ── Phase 8 — Delegation Credentials ────────────────────────────────────

import type {
  AgentIdentity,
  AgentKeyPair,
  DelegationCredential,
} from "../types/identity-types.js";
import { signData } from "./agent-identity.js";
import { loadKeyPair } from "./identity-store.js";

// ── Credential Creation ────────────────────────────────────────────────

/**
 * Creates a signed delegation credential.
 * @param issuer - Either an AgentIdentity object or an agentId string.
 *                 If a string is passed, the issuer's key pair and metadata
 *                 are loaded from the identity store.
 */
export async function createDelegationCredential(
  issuer: AgentIdentity | string,
  delegatee: string,
  scope: string[],
  keyPair: AgentKeyPair
): Promise<DelegationCredential> {
  const issuanceDate = new Date().toISOString();

  const issuerId = typeof issuer === "string" ? issuer : issuer.agentId;
  const issuerRole = typeof issuer === "string" ? "delegate" : issuer.metadata.role;

  const credentialSubject = {
    id: delegatee,
    role: issuerRole,
    scope,
  };

  const payload = JSON.stringify({
    issuer: issuerId,
    issuanceDate,
    credentialSubject,
  });

  // Build a minimal identity for signing
  const signingIdentity: AgentIdentity =
    typeof issuer === "string"
      ? {
          agentId: issuer,
          publicKey: keyPair.publicKey,
          createdAt: issuanceDate,
          metadata: { role: "unknown", displayName: issuer, version: "1.0.0" },
        }
      : issuer;

  const proofValue = await signData(signingIdentity, payload, keyPair);

  return {
    issuer: issuerId,
    issuanceDate,
    credentialSubject,
    proof: {
      type: "Ed25519Signature2020",
      created: issuanceDate,
      verificationMethod: `did:agent:${issuerId}#key-1`,
      proofPurpose: "assertionMethod",
      proofValue,
    },
  };
}

// ── Credential Verification ────────────────────────────────────────────

export async function verifyDelegation(
  credential: DelegationCredential
): Promise<boolean> {
  if (!credential.issuer || !credential.issuanceDate) return false;
  if (!credential.credentialSubject || !credential.credentialSubject.id) return false;
  if (!credential.proof || !credential.proof.proofValue) return false;

  // Verify the proof value is valid base64
  try {
    const decoded = Buffer.from(credential.proof.proofValue, "base64");
    if (decoded.length === 0) return false;
  } catch {
    return false;
  }

  // If we have the issuer's key pair, do a full cryptographic verification
  const issuerKeyPair = await loadKeyPair(credential.issuer);
  if (issuerKeyPair) {
    const payload = JSON.stringify({
      issuer: credential.issuer,
      issuanceDate: credential.issuanceDate,
      credentialSubject: credential.credentialSubject,
    });
    const { verifySignature } = await import("./agent-identity.js");
    return verifySignature(
      issuerKeyPair.publicKey,
      credential.proof.proofValue,
      payload
    );
  }

  return true;
}

// ── Scope-Based Authorization ──────────────────────────────────────────

export function isActionAuthorized(
  credential: DelegationCredential,
  action: string
): boolean {
  return credential.credentialSubject.scope.includes(action);
}
