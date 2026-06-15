// ── Phase 8 — Agent Identity Layer ──────────────────────────────────────
// Ed25519 identity, signing, verification, registration, rotation, revocation.

import { randomUUID } from "node:crypto";
import type {
  AgentIdentity,
  AgentIdentityMetadata,
  AgentKeyPair,
  AgentRegistration,
  AgentDIDDocument,
} from "../types/identity-types.js";
import { saveKeyPair, loadKeyPair, deleteKeyPair } from "./identity-store.js";

// ── Key Generation ─────────────────────────────────────────────────────

export async function generateKeyPair(): Promise<AgentKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );

  const publicKeyRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const privateKeyRaw = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

  return {
    publicKey: Buffer.from(publicKeyRaw).toString("base64"),
    privateKey: Buffer.from(privateKeyRaw).toString("base64"),
  };
}

// ── Identity Creation ──────────────────────────────────────────────────

export async function createAgentIdentity(
  role: string,
  displayName: string
): Promise<AgentIdentity> {
  const agentId = randomUUID();
  const keyPair = await generateKeyPair();

  const metadata: AgentIdentityMetadata = {
    role,
    displayName,
    version: "1.0.0",
  };

  const identity: AgentIdentity = {
    agentId,
    publicKey: keyPair.publicKey,
    createdAt: new Date().toISOString(),
    metadata,
  };

  await saveKeyPair(agentId, keyPair);

  return identity;
}

// ── Signing ────────────────────────────────────────────────────────────

export async function signData(
  identity: AgentIdentity,
  data: string,
  keyPair: AgentKeyPair
): Promise<string> {
  const privateKeyDer = Buffer.from(keyPair.privateKey, "base64");

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyDer,
    { name: "Ed25519" },
    false,
    ["sign"]
  );

  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign("Ed25519", privateKey, encoder.encode(data));

  return Buffer.from(signature).toString("base64");
}

// ── Verification ───────────────────────────────────────────────────────

export async function verifySignature(
  publicKey: string,
  signature: string,
  data: string
): Promise<boolean> {
  const publicKeyRaw = Buffer.from(publicKey, "base64");
  const signatureBytes = Buffer.from(signature, "base64");

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    publicKeyRaw,
    { name: "Ed25519" },
    false,
    ["verify"]
  );

  const encoder = new TextEncoder();
  return crypto.subtle.verify("Ed25519", cryptoKey, signatureBytes, encoder.encode(data));
}

// ── Registration ───────────────────────────────────────────────────────

export async function registerAgent(
  identity: AgentIdentity
): Promise<AgentRegistration> {
  const did = `did:agent:${identity.agentId}`;

  const document: AgentDIDDocument = {
    "@context": "https://www.w3.org/ns/did/v1",
    id: did,
    verificationMethod: [
      {
        id: `${did}#key-1`,
        type: "Ed25519VerificationKey2020",
        controller: did,
        publicKeyMultibase: identity.publicKey,
      },
    ],
    authentication: [`${did}#key-1`],
  };

  return {
    did,
    document,
    registeredAt: new Date().toISOString(),
    status: "active",
  };
}

// ── Revocation ─────────────────────────────────────────────────────────

const revokedAgents = new Map<string, { reason: string; revokedAt: string }>();

export async function revokeAgent(agentId: string, reason: string): Promise<void> {
  revokedAgents.set(agentId, { reason, revokedAt: new Date().toISOString() });
  await deleteKeyPair(agentId);
}

export function isAgentRevoked(agentId: string): boolean {
  return revokedAgents.has(agentId);
}

export function getRevocationInfo(
  agentId: string
): { reason: string; revokedAt: string } | undefined {
  return revokedAgents.get(agentId);
}

export function getRevocationReason(agentId: string): string | undefined {
  return revokedAgents.get(agentId)?.reason;
}

// ── Key Rotation ───────────────────────────────────────────────────────

export async function rotateKeyPair(agentId: string): Promise<AgentKeyPair> {
  const existing = await loadKeyPair(agentId);
  if (!existing) {
    throw new Error(`No existing key pair for agent ${agentId}`);
  }

  const newKeyPair = await generateKeyPair();
  await saveKeyPair(agentId, newKeyPair);

  return newKeyPair;
}
