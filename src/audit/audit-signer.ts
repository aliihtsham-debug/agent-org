// ── Phase 10 — Audit Signer ─────────────────────────────────────────────
//
// Bridges the identity layer and audit system.
// Signs audit entries with the agent's identity key.

import type { AgentIdentity, AgentKeyPair } from "../types/identity-types.js";
import type { AuditEntry, AuditActionType } from "../types/audit-types.js";
import { signData, verifySignature } from "../identity/agent-identity.js";
import type { AuditLog } from "./audit-log.js";

/**
 * Compute SHA-256 hash of a string using crypto.subtle.digest.
 */
async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Sign an audit entry with the agent's identity key.
 * Returns a new entry with the signature field populated.
 */
export async function signEntry(
  entry: Omit<AuditEntry, "sequence" | "entryHash" | "previousHash" | "signature">,
  identity: AgentIdentity,
  keyPair: AgentKeyPair,
): Promise<Omit<AuditEntry, "sequence" | "entryHash" | "previousHash" | "signature"> & { signature: string }> {
  const payload = JSON.stringify({
    agentDid: entry.agentDid,
    action: entry.action,
    inputHash: entry.inputHash,
    outputHash: entry.outputHash,
    inputRef: entry.inputRef,
    outputRef: entry.outputRef,
    timestamp: entry.timestamp,
    eventId: entry.eventId,
  });

  const signature = await signData(identity, payload, keyPair);

  return { ...entry, signature };
}

/**
 * Sign an event with the agent's identity key and record it in the audit log.
 */
export async function signAndRecord(
  event: {
    agentDid: string;
    action: AuditActionType;
    inputRef: string;
    outputRef: string;
    timestamp: string;
    eventId: string;
  },
  identity: AgentIdentity,
  keyPair: AgentKeyPair,
  auditLog: AuditLog,
): Promise<AuditEntry> {
  const inputHash = await sha256(event.inputRef);
  const outputHash = await sha256(event.outputRef);

  const signedEntry = await signEntry(
    {
      agentDid: event.agentDid,
      action: event.action,
      inputHash,
      outputHash,
      inputRef: event.inputRef,
      outputRef: event.outputRef,
      timestamp: event.timestamp,
      eventId: event.eventId,
    },
    identity,
    keyPair,
  );

  return auditLog.appendEntry(signedEntry);
}

/**
 * Verify an audit entry's signature using the agent's public key.
 */
export async function verifyEntry(
  entry: AuditEntry,
  publicKey: string,
): Promise<boolean> {
  if (!entry.signature) return false;
  if (!entry.agentDid) return false;

  const payload = JSON.stringify({
    agentDid: entry.agentDid,
    action: entry.action,
    inputHash: entry.inputHash,
    outputHash: entry.outputHash,
    inputRef: entry.inputRef,
    outputRef: entry.outputRef,
    timestamp: entry.timestamp,
    eventId: entry.eventId,
  });

  return verifySignature(publicKey, entry.signature, payload);
}
