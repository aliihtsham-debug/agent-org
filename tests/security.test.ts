/**
 * Phase 13 — Enterprise Security Platform Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { createSecretsProvider } from "../src/security/secrets-adapter.js";
import { createTEEProvider } from "../src/security/tee-adapter.js";
import { verifyAgentIdentity, createSecureChannel } from "../src/security/zero-trust.js";
import { verifyFilePath, createSecureRunner } from "../src/security/runtime-enforcement.js";

const TEST_SECRETS_DIR = "outputs/.secrets-test";

describe("Phase 13 — Enterprise Security Platform", () => {
  beforeEach(async () => {
    await mkdir(TEST_SECRETS_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_SECRETS_DIR, { recursive: true, force: true }).catch(() => {});
  });

  it("1. secrets provider CRUD", async () => {
    const provider = createSecretsProvider("local");
    await provider.setSecret("test-key", "test-value");

    const value = await provider.getSecret("test-key");
    expect(value).toBe("test-value");

    await provider.deleteSecret("test-key");
    const deleted = await provider.getSecret("test-key");
    expect(deleted).toBeNull();
  });

  it("2. TEE attestation (simulation)", async () => {
    const tee = createTEEProvider("local");
    const report = await tee.attest();

    expect(report.valid).toBe(true);
    expect(report.timestamp).toBeDefined();
    expect(report.environment).toBe("local");
    expect(report.measurements).toBeDefined();
  });

  it("3. identity verification rejects invalid DID", async () => {
    const validIdentity = {
      agentId: "550e8400-e29b-41d4-a716-446655440000",
      publicKey: "dGVzdHB1YmxpY2tleQ==", // valid base64
      createdAt: new Date().toISOString(),
      metadata: { role: "ceo", displayName: "CEO", version: "1.0.0" },
    };
    expect(await verifyAgentIdentity(validIdentity)).toBe(true);

    const invalidIdentity = {
      agentId: "",
      publicKey: "not-valid-base64!!!",
      createdAt: new Date().toISOString(),
      metadata: { role: "ceo", displayName: "CEO", version: "1.0.0" },
    };
    expect(await verifyAgentIdentity(invalidIdentity)).toBe(false);
  });

  it("4. secure channel establishment", async () => {
    const from = {
      agentId: "agent-from",
      publicKey: "dGVzdA==",
      createdAt: new Date().toISOString(),
      metadata: { role: "ceo", displayName: "CEO", version: "1.0.0" },
    };
    const to = {
      agentId: "agent-to",
      publicKey: "dGVzdA==",
      createdAt: new Date().toISOString(),
      metadata: { role: "cto", displayName: "CTO", version: "1.0.0" },
    };

    const channel = await createSecureChannel(from, to);
    expect(channel.established).toBe(true);
    expect(channel.from).toBe("agent-from");
    expect(channel.to).toBe("agent-to");
  });

  it("5. runtime policy enforcement blocks unauthorized file writes", () => {
    expect(verifyFilePath("/project/outputs/test.md", "/project/outputs")).toBe(true);
    expect(verifyFilePath("/etc/passwd", "/project/outputs")).toBe(false);
    expect(verifyFilePath("../etc/passwd", "/project/outputs")).toBe(false);
  });

  it("6. output signing integration", async () => {
    const runner = createSecureRunner(async (spec, ctx) => ({
      role: spec.role,
      status: "completed" as const,
      outputPath: spec.outputPath,
      summary: "Test output",
      artifacts: [],
      tokenUsage: { input: 100, output: 200 },
      durationMs: 100,
    }));

    const { generateKeyPair, createAgentIdentity, signData } = await import("../src/identity/agent-identity.js");
    const kp = await generateKeyPair();
    const identity = await createAgentIdentity("ceo", "CEO");

    const result = await runner(
      { id: "test", role: "ceo", task: "test", context: "", outputPath: "outputs/test" },
      {
        apiKey: "", baseURL: "", outputBase: "outputs",
        logger: { info: () => {} } as any,
        parentRole: "ceo", readArtifact: async () => null,
        projectRoot: ".", enableWebTools: false,
        resultsRegistry: {} as any, messageBus: {} as any,
        runId: "test-run",
        security: { identity, keyPair: kp },
      } as any,
    );

    expect(result.producedBy).toBe(identity.agentId);
    expect(result.signature).toBeDefined();
  });
});
