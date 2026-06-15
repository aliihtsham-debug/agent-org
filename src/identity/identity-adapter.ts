import {
  generateKeyPair,
  createAgentIdentity,
  signData,
  verifySignature,
  registerAgent,
  revokeAgent,
  rotateKeyPair,
} from "./agent-identity.js";
import { saveKeyPair, loadKeyPair } from "./identity-store.js";
import { AgentIdentity, AgentKeyPair } from "../types/identity-types.js";

// ── Identity Provider Interface ────────────────────────────────────────────

export interface IdentityProvider {
  register(identity: AgentIdentity): Promise<{ did: string; document: unknown }>;
  issue(identity: AgentIdentity, data: string, keyPair: AgentKeyPair): Promise<string>;
  rotate(agentId: string): Promise<AgentKeyPair>;
  revoke(agentId: string, reason: string): Promise<void>;
  verify(publicKey: string, signature: string, data: string): Promise<boolean>;
}

// ── Local Identity Provider ────────────────────────────────────────────────

export class LocalIdentityProvider implements IdentityProvider {
  async register(identity: AgentIdentity): Promise<{ did: string; document: unknown }> {
    const registration = await registerAgent(identity);
    return { did: registration.did, document: registration.document };
  }

  async issue(identity: AgentIdentity, data: string, keyPair: AgentKeyPair): Promise<string> {
    return signData(identity, data, keyPair);
  }

  async rotate(agentId: string): Promise<AgentKeyPair> {
    return rotateKeyPair(agentId);
  }

  async revoke(agentId: string, reason: string): Promise<void> {
    await revokeAgent(agentId, reason);
  }

  async verify(publicKey: string, signature: string, data: string): Promise<boolean> {
    return verifySignature(publicKey, signature, data);
  }
}

// ── Terminal 3 Adapter (Stub) ──────────────────────────────────────────────

export class Terminal3Adapter implements IdentityProvider {
  async register(identity: AgentIdentity): Promise<{ did: string; document: unknown }> {
    console.log("Terminal 3 SDK not configured");
    throw new Error("Terminal 3 SDK not configured");
  }

  async issue(identity: AgentIdentity, data: string, keyPair: AgentKeyPair): Promise<string> {
    console.log("Terminal 3 SDK not configured");
    throw new Error("Terminal 3 SDK not configured");
  }

  async rotate(agentId: string): Promise<AgentKeyPair> {
    console.log("Terminal 3 SDK not configured");
    throw new Error("Terminal 3 SDK not configured");
  }

  async revoke(agentId: string, reason: string): Promise<void> {
    console.log("Terminal 3 SDK not configured");
    throw new Error("Terminal 3 SDK not configured");
  }

  async verify(publicKey: string, signature: string, data: string): Promise<boolean> {
    console.log("Terminal 3 SDK not configured");
    throw new Error("Terminal 3 SDK not configured");
  }
}
