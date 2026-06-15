import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  generateKeyPair,
  createAgentIdentity,
  signData,
  verifySignature,
  registerAgent,
  revokeAgent,
  rotateKeyPair,
} from "../src/identity/agent-identity.js";
import {
  createDelegationCredential,
  verifyDelegation,
  isActionAuthorized,
} from "../src/identity/delegation.js";
import {
  saveKeyPair,
  loadKeyPair,
  deleteKeyPair,
  listIdentities,
} from "../src/identity/identity-store.js";

const TEST_IDENTITY_DIR = join(__dirname, "..", "outputs", ".identity-test");

describe("Agent Identity Layer", () => {
  beforeEach(() => {
    rmSync(TEST_IDENTITY_DIR, { recursive: true, force: true });
    mkdirSync(TEST_IDENTITY_DIR, { recursive: true });
    process.env.IDENTITY_STORE_DIR = TEST_IDENTITY_DIR;
  });

  afterEach(() => {
    rmSync(TEST_IDENTITY_DIR, { recursive: true, force: true });
    delete process.env.IDENTITY_STORE_DIR;
  });

  it("1. Key pair generation produces valid Ed25519 keys", async () => {
    const keyPair = await generateKeyPair();

    expect(keyPair).toBeDefined();
    expect(keyPair.publicKey).toBeDefined();
    expect(keyPair.privateKey).toBeDefined();
    expect(typeof keyPair.publicKey).toBe("string");
    expect(typeof keyPair.privateKey).toBe("string");
    expect(keyPair.publicKey.length).toBeGreaterThan(0);
    expect(keyPair.privateKey.length).toBeGreaterThan(0);

    // Ed25519 raw public key is 32 bytes = 44 base64 chars
    const publicKeyBytes = Buffer.from(keyPair.publicKey, "base64");
    expect(publicKeyBytes.length).toBe(32);
  });

  it("2. Data signing and verification roundtrip", async () => {
    const keyPair = await generateKeyPair();
    const identity = await createAgentIdentity("test-role", "Test Agent");
    const data = "Hello, Agent Org!";

    const signature = await signData(identity, data, keyPair);
    expect(signature).toBeDefined();
    expect(typeof signature).toBe("string");
    expect(signature.length).toBeGreaterThan(0);

    const isValid = await verifySignature(keyPair.publicKey, signature, data);
    expect(isValid).toBe(true);
  });

  it("3. Signature verification fails with wrong public key", async () => {
    const keyPair1 = await generateKeyPair();
    const keyPair2 = await generateKeyPair();
    const identity = await createAgentIdentity("test-role", "Test Agent");
    const data = "Hello, Agent Org!";

    const signature = await signData(identity, data, keyPair1);

    // Verify with a different public key should fail
    const isValid = await verifySignature(keyPair2.publicKey, signature, data);
    expect(isValid).toBe(false);
  });

  it("4. Signature verification fails with tampered data", async () => {
    const keyPair = await generateKeyPair();
    const identity = await createAgentIdentity("test-role", "Test Agent");
    const data = "Hello, Agent Org!";
    const tamperedData = "Hello, Agent Org?";

    const signature = await signData(identity, data, keyPair);

    // Verify with tampered data should fail
    const isValid = await verifySignature(keyPair.publicKey, signature, tamperedData);
    expect(isValid).toBe(false);
  });

  it("5. Agent identity creation with DID format", async () => {
    const identity = await createAgentIdentity("cto", "CTO Agent");

    expect(identity).toBeDefined();
    expect(identity.agentId).toBeDefined();
    expect(identity.agentId.length).toBe(36); // UUID v4 format
    expect(identity.publicKey).toBeDefined();
    expect(identity.createdAt).toBeDefined();
    expect(identity.metadata.role).toBe("cto");
    expect(identity.metadata.displayName).toBe("CTO Agent");
    expect(identity.metadata.version).toBe("1.0.0");

    // Register and verify DID format
    const registration = await registerAgent(identity);
    expect(registration.did).toBe(`did:agent:${identity.agentId}`);
    expect(registration.did.startsWith("did:agent:")).toBe(true);
    expect(registration.status).toBe("active");
    expect(registration.document["@context"]).toBe("https://www.w3.org/ns/did/v1");
    expect(registration.document.id).toBe(registration.did);
    expect(registration.document.verificationMethod.length).toBe(1);
    expect(registration.document.authentication.length).toBe(1);
  });

  it("6. Delegation credential creation and verification", async () => {
    const issuerKeyPair = await generateKeyPair();
    const issuerIdentity = await createAgentIdentity("ceo", "CEO Agent");

    const credential = await createDelegationCredential(
      issuerIdentity.agentId,
      "did:agent:delegatee-123",
      ["read", "write"],
      issuerKeyPair
    );

    expect(credential).toBeDefined();
    expect(credential.issuer).toBe(issuerIdentity.agentId);
    expect(credential.credentialSubject.id).toBe("did:agent:delegatee-123");
    expect(credential.credentialSubject.role).toBe("delegate");
    expect(credential.credentialSubject.scope).toEqual(["read", "write"]);
    expect(credential.proof.type).toBe("Ed25519Signature2020");
    expect(credential.proof.proofValue).toBeDefined();

    // Save issuer key pair for verification
    await saveKeyPair(issuerIdentity.agentId, issuerKeyPair);

    const isValid = await verifyDelegation(credential);
    expect(isValid).toBe(true);
  });

  it("7. Delegation scope checking (authorized and unauthorized actions)", async () => {
    const issuerKeyPair = await generateKeyPair();
    const issuerIdentity = await createAgentIdentity("ceo", "CEO Agent");

    const credential = await createDelegationCredential(
      issuerIdentity.agentId,
      "did:agent:delegatee-456",
      ["read", "write", "deploy"],
      issuerKeyPair
    );

    // Authorized actions
    expect(isActionAuthorized(credential, "read")).toBe(true);
    expect(isActionAuthorized(credential, "write")).toBe(true);
    expect(isActionAuthorized(credential, "deploy")).toBe(true);

    // Unauthorized actions
    expect(isActionAuthorized(credential, "admin")).toBe(false);
    expect(isActionAuthorized(credential, "delete")).toBe(false);
    expect(isActionAuthorized(credential, "execute")).toBe(false);
  });

  it("8. Identity store save/load roundtrip", async () => {
    const keyPair = await generateKeyPair();
    const agentId = "test-agent-001";

    await saveKeyPair(agentId, keyPair);

    const loaded = await loadKeyPair(agentId);
    expect(loaded).not.toBeNull();
    expect(loaded!.publicKey).toBe(keyPair.publicKey);
    expect(loaded!.privateKey).toBe(keyPair.privateKey);
  });

  it("9. Identity store deletion", async () => {
    const keyPair = await generateKeyPair();
    const agentId = "test-agent-002";

    await saveKeyPair(agentId, keyPair);
    let loaded = await loadKeyPair(agentId);
    expect(loaded).not.toBeNull();

    await deleteKeyPair(agentId);
    loaded = await loadKeyPair(agentId);
    expect(loaded).toBeNull();
  });

  it("10. Identity listing", async () => {
    // Create multiple identities
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const id1 = "list-test-1";
    const id2 = "list-test-2";

    await saveKeyPair(id1, kp1);
    await saveKeyPair(id2, kp2);

    const identities = await listIdentities();
    const ids = identities.map(i => i.agentId);

    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
    expect(identities.length).toBeGreaterThanOrEqual(2);
  });

  it("11. Key rotation preserves agentId but changes keys", async () => {
    const identity = await createAgentIdentity("test-role", "Rotation Test Agent");
    const agentId = identity.agentId;

    // Load original keys
    const originalKeyPair = await loadKeyPair(agentId);
    expect(originalKeyPair).not.toBeNull();

    // Rotate keys
    const newKeyPair = await rotateKeyPair(agentId);
    expect(newKeyPair).toBeDefined();
    expect(newKeyPair.publicKey).not.toBe(originalKeyPair!.publicKey);
    expect(newKeyPair.privateKey).not.toBe(originalKeyPair!.privateKey);

    // Verify new keys are stored
    const storedNew = await loadKeyPair(agentId);
    expect(storedNew).not.toBeNull();
    expect(storedNew!.publicKey).toBe(newKeyPair.publicKey);
    expect(storedNew!.privateKey).toBe(newKeyPair.privateKey);

    // Agent ID remains the same
    expect(agentId.length).toBe(36); // Still a valid UUID
  });

  it("12. Registration revocation marks agent as revoked", async () => {
    const identity = await createAgentIdentity("test-role", "Revocation Test Agent");
    const agentId = identity.agentId;

    // Register the agent
    const registration = await registerAgent(identity);
    expect(registration.status).toBe("active");

    // Revoke the agent
    await revokeAgent(agentId, "Test revocation");

    // Verify revocation
    const { isAgentRevoked, getRevocationReason } = await import("../src/identity/agent-identity.js");
    expect(isAgentRevoked(agentId)).toBe(true);
    expect(getRevocationReason(agentId)).toBe("Test revocation");

    // Other agents should not be revoked
    expect(isAgentRevoked("nonexistent-agent")).toBe(false);
  });
});
