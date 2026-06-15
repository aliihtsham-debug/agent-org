// ── Phase 10 — Enterprise Audit System Tests ────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, readFile, writeFile, access } from "node:fs/promises";
import { AuditLog } from "../src/audit/audit-log.js";
import { ProvenanceTracker } from "../src/audit/provenance-tracker.js";
import { generateReport, findGaps, exportReport } from "../src/audit/compliance-export.js";
import type { AuditEntry } from "../src/types/audit-types.js";

const TEST_AUDIT_DIR = `outputs/.audit-test-${Date.now()}`;
const TEST_AUDIT_FILE = `${TEST_AUDIT_DIR}/audit-chain.jsonl`;

describe("Phase 10 — Enterprise Audit System", () => {
  beforeEach(async () => {
    await rm(TEST_AUDIT_DIR, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_AUDIT_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_AUDIT_DIR, { recursive: true, force: true }).catch(() => {});
  });

  // ── 1. Audit entry creation with hash chain ──────────────────────────

  it("1. creates audit entries with hash chain", async () => {
    const log = new AuditLog(TEST_AUDIT_FILE);

    const entry1 = await log.appendEntry({
      agentDid: "did:agent:ceo-123",
      action: "agent_spawn",
      inputHash: "abc123",
      outputHash: "def456",
      inputRef: "idea",
      outputRef: "outputs/ceo/output.md",
      timestamp: new Date().toISOString(),
      eventId: "evt-1",
      signature: "sig-1",
    });

    expect(entry1.sequence).toBe(0);
    expect(entry1.previousHash).toBe("genesis");
    expect(entry1.entryHash).toBeDefined();
    expect(entry1.entryHash.length).toBeGreaterThan(0);
    // SHA-256 produces 64 hex characters
    expect(entry1.entryHash.length).toBe(64);

    const entry2 = await log.appendEntry({
      agentDid: "did:agent:cto-456",
      action: "agent_output",
      inputHash: "ghi789",
      outputHash: "jkl012",
      inputRef: "outputs/ceo/output.md",
      outputRef: "outputs/cto/output.md",
      timestamp: new Date().toISOString(),
      eventId: "evt-2",
      signature: "sig-2",
    });

    expect(entry2.sequence).toBe(1);
    expect(entry2.previousHash).toBe(entry1.entryHash);
    expect(entry2.entryHash.length).toBe(64);
  });

  // ── 2. Chain verification (valid chain passes) ───────────────────────

  it("2. verifies a valid chain passes", async () => {
    const log = new AuditLog(TEST_AUDIT_FILE);

    await log.appendEntry({
      agentDid: "did:agent:test",
      action: "agent_spawn",
      inputHash: "a",
      outputHash: "b",
      inputRef: "in",
      outputRef: "out",
      timestamp: new Date().toISOString(),
      eventId: "e1",
      signature: "s1",
    });

    await log.appendEntry({
      agentDid: "did:agent:test",
      action: "agent_output",
      inputHash: "c",
      outputHash: "d",
      inputRef: "in2",
      outputRef: "out2",
      timestamp: new Date().toISOString(),
      eventId: "e2",
      signature: "s2",
    });

    const result = await log.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.firstInvalid).toBeUndefined();
  });

  // ── 3. Chain verification (tampered entry detected) ──────────────────

  it("3. detects tampered entries", async () => {
    const log = new AuditLog(TEST_AUDIT_FILE);

    await log.appendEntry({
      agentDid: "did:agent:test",
      action: "agent_spawn",
      inputHash: "a",
      outputHash: "b",
      inputRef: "in",
      outputRef: "out",
      timestamp: new Date().toISOString(),
      eventId: "e1",
      signature: "s1",
    });

    // Tamper with the file directly
    const raw = await readFile(TEST_AUDIT_FILE, "utf-8");
    const lines = raw.trim().split("\n");
    const parsed = JSON.parse(lines[0]) as AuditEntry;
    parsed.agentDid = "tampered-agent";
    lines[0] = JSON.stringify(parsed);
    await writeFile(TEST_AUDIT_FILE, lines.join("\n") + "\n");

    // New log instance reads the tampered file
    const log2 = new AuditLog(TEST_AUDIT_FILE);
    const result = await log2.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.firstInvalid).toBe(0);
  });

  // ── 4. Chain verification (missing sequence detected) ────────────────

  it("4. detects missing sequence", async () => {
    // Manually write a file with a gap in sequence numbers
    const entry: AuditEntry = {
      agentDid: "did:agent:test",
      action: "agent_output",
      inputHash: "c",
      outputHash: "d",
      inputRef: "in2",
      outputRef: "out2",
      timestamp: new Date().toISOString(),
      eventId: "e2",
      signature: "s2",
      sequence: 5, // Should be 0 — gap detected
      previousHash: "somehash",
      entryHash: "somehash2",
    };
    await writeFile(TEST_AUDIT_FILE, JSON.stringify(entry) + "\n");

    const log = new AuditLog(TEST_AUDIT_FILE);
    const result = await log.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.firstInvalid).toBe(0);
  });

  // ── 5. Sequential append preserves hash chain ────────────────────────

  it("5. sequential append preserves hash chain", async () => {
    const log = new AuditLog(TEST_AUDIT_FILE);
    const hashes: string[] = [];

    for (let i = 0; i < 5; i++) {
      const entry = await log.appendEntry({
        agentDid: `did:agent:agent-${i}`,
        action: "agent_output",
        inputHash: `input-${i}`,
        outputHash: `output-${i}`,
        inputRef: `in-${i}`,
        outputRef: `out-${i}`,
        timestamp: new Date().toISOString(),
        eventId: `evt-${i}`,
        signature: `sig-${i}`,
      });
      hashes.push(entry.entryHash);
    }

    // Verify the full chain is valid
    const result = await log.verifyChain();
    expect(result.valid).toBe(true);

    // Verify each hash is unique (no collisions)
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(5);

    // Verify chain linkage: each entry's previousHash === previous entry's hash
    const entries = await log.getEntries();
    expect(entries[0].previousHash).toBe("genesis");
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].previousHash).toBe(entries[i - 1].entryHash);
    }
  });

  // ── 6. Provenance tracking: delegation chain ─────────────────────────

  it("6. provenance tracking: delegation chain", () => {
    const tracker = new ProvenanceTracker();

    tracker.trackDecision("decision-1", "Build a product");
    tracker.trackDelegation("ceo", "cto", "spawn", "idea");
    tracker.trackDelegation("cto", "eng-manager", "spawn", "cto-output");

    const allProv = tracker.getAllProvenance();
    expect(allProv.length).toBeGreaterThan(0);

    const decision = allProv[0];
    expect(decision.delegations.length).toBe(2);
    expect(decision.timeline.length).toBe(2);
    expect(decision.delegations[0].from).toBe("ceo");
    expect(decision.delegations[0].to).toBe("cto");
    expect(decision.delegations[1].from).toBe("cto");
    expect(decision.delegations[1].to).toBe("eng-manager");
  });

  // ── 7. Provenance tracking: full decision from idea to IC output ──────

  it("7. provenance tracking: full decision from idea to IC output", () => {
    const tracker = new ProvenanceTracker();

    tracker.trackDecision("decision-1", "Build a SaaS platform");
    tracker.trackDelegation("ceo", "cto", "spawn", "idea");
    tracker.trackDelegation("cto", "backend-engineer", "spawn", "architecture");
    tracker.trackOutput("backend-engineer", "outputs/backend/output.md", ["outputs/cto/output.md"]);

    const provenance = tracker.getProvenance("decision-1");
    expect(provenance).toBeDefined();
    expect(provenance!.idea).toBe("Build a SaaS platform");
    expect(provenance!.delegations.length).toBe(2);
    expect(provenance!.outputs.length).toBe(1);
    expect(provenance!.outputs[0]).toBe("outputs/backend/output.md");
    expect(provenance!.inputs.length).toBe(1);
    expect(provenance!.inputs[0]).toBe("outputs/cto/output.md");
    expect(provenance!.timeline.length).toBe(3); // 2 delegations + 1 output
  });

  // ── 8. Compliance report generation ───────────────────────────────────

  it("8. generates compliance report", async () => {
    const log = new AuditLog(TEST_AUDIT_FILE);

    const entries = [
      await log.appendEntry({
        agentDid: "did:agent:ceo",
        action: "agent_spawn",
        inputHash: "a",
        outputHash: "b",
        inputRef: "idea",
        outputRef: "ceo-output",
        timestamp: new Date().toISOString(),
        eventId: "e1",
        signature: "sig-1",
      }),
    ];

    const tracker = new ProvenanceTracker();
    tracker.trackDecision("d1", "Test idea");
    tracker.trackDelegation("ceo", "cto", "spawn", "idea");
    const provenance = tracker.getAllProvenance();

    const report = generateReport("SOC2", entries, provenance);
    expect(report.reportId).toBeDefined();
    expect(report.reportId.startsWith("rpt_")).toBe(true);
    expect(report.standard).toBe("SOC2");
    expect(report.generatedAt).toBeDefined();
    expect(report.entries.length).toBe(1);
    expect(report.provenance.length).toBe(1);
    expect(report.findings).toBeDefined();
    expect(Array.isArray(report.findings)).toBe(true);
  });

  // ── 9. Compliance gap detection ──────────────────────────────────────

  it("9. detects compliance gaps: missing approvals and unsigned outputs", () => {
    const entries: AuditEntry[] = [
      {
        sequence: 0,
        agentDid: "did:agent:ceo",
        action: "agent_output",
        inputHash: "a",
        outputHash: "b",
        inputRef: "idea",
        outputRef: "ceo-output",
        timestamp: new Date().toISOString(),
        eventId: "e1",
        signature: "", // Missing signature
        previousHash: "genesis",
        entryHash: "hash1",
      },
      {
        sequence: 1,
        agentDid: "did:agent:cto",
        action: "agent_output",
        inputHash: "c",
        outputHash: "d",
        inputRef: "ceo-output",
        outputRef: "cto-output",
        timestamp: new Date().toISOString(),
        eventId: "e2",
        signature: "", // Missing signature
        previousHash: "hash1",
        entryHash: "hash2",
      },
    ];

    const findings = findGaps(entries, "SOC2");

    // Should detect unsigned outputs
    const unsignedFinding = findings.find((f) => f.description.includes("not cryptographically signed"));
    expect(unsignedFinding).toBeDefined();
    expect(unsignedFinding!.severity).toBe("high");

    // Should detect missing approvals
    const approvalFinding = findings.find((f) => f.description.includes("approval"));
    expect(approvalFinding).toBeDefined();
  });

  // ── 10. Audit export to JSON ─────────────────────────────────────────

  it("10. exports audit log to JSON", async () => {
    const log = new AuditLog(TEST_AUDIT_FILE);

    await log.appendEntry({
      agentDid: "did:agent:test",
      action: "agent_spawn",
      inputHash: "a",
      outputHash: "b",
      inputRef: "in",
      outputRef: "out",
      timestamp: new Date().toISOString(),
      eventId: "e1",
      signature: "s1",
    });

    const exportPath = `${TEST_AUDIT_DIR}/export.json`;
    await log.exportToJSON(exportPath);

    // Verify file exists and contains valid JSON
    await access(exportPath);
    const raw = await readFile(exportPath, "utf-8");
    const exported: AuditEntry[] = JSON.parse(raw);
    expect(exported.length).toBe(1);
    expect(exported[0].agentDid).toBe("did:agent:test");
    expect(exported[0].action).toBe("agent_spawn");
    expect(exported[0].entryHash.length).toBe(64);
  });
});
