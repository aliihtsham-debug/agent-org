/**
 * Phase 15 — Design Partner Edition Tests
 */

import { describe, it, expect } from "vitest";
import { GOVERNMENT_WORKFLOW } from "../src/templates/government-workflow.js";
import { BANKING_COMPLIANCE } from "../src/templates/banking-compliance.js";
import { EnterpriseOnboarding } from "../src/templates/enterprise-onboarding.js";
import { createWhiteLabelConfig } from "../src/templates/white-label.js";
import { PolicyEngine } from "../src/governance/policy-engine.js";

describe("Phase 15 — Design Partner Edition", () => {
  describe("Government Workflow Template", () => {
    it("1. has correct name and description", () => {
      expect(GOVERNMENT_WORKFLOW.name).toBe("Government Workflow");
      expect(GOVERNMENT_WORKFLOW.description).toContain("FedRAMP");
      expect(GOVERNMENT_WORKFLOW.description).toContain("NIST 800-53");
    });

    it("2. has 4 policy rules", () => {
      expect(GOVERNMENT_WORKFLOW.rules.length).toBe(4);
    });

    it("3. allows read operations", () => {
      const engine = new PolicyEngine();
      GOVERNMENT_WORKFLOW.rules.forEach((r) => engine.addPolicy(r));
      const decision = engine.evaluate("ceo", "read", {
        riskLevel: "low",
        delegationDepth: 0,
        timestamp: new Date().toISOString(),
      });
      expect(decision.allowed).toBe(true);
    });

    it("4. requires dual approval for write operations", () => {
      const engine = new PolicyEngine();
      GOVERNMENT_WORKFLOW.rules.forEach((r) => engine.addPolicy(r));
      const decision = engine.evaluate("ceo", "write_file", {
        riskLevel: "medium",
        delegationDepth: 0,
        timestamp: new Date().toISOString(),
      });
      expect(decision.effect).toBe("require_approval");
    });

    it("5. denies shell execution", () => {
      const engine = new PolicyEngine();
      GOVERNMENT_WORKFLOW.rules.forEach((r) => engine.addPolicy(r));
      const decision = engine.evaluate("ceo", "shell_exec", {
        riskLevel: "critical",
        delegationDepth: 0,
        timestamp: new Date().toISOString(),
      });
      expect(decision.allowed).toBe(false);
      expect(decision.effect).toBe("deny");
    });

    it("6. has dual-approval matrix for critical risk", () => {
      expect(GOVERNMENT_WORKFLOW.approvalMatrix.critical.minApprovals).toBe(2);
      expect(GOVERNMENT_WORKFLOW.approvalMatrix.critical.approvers).toContain("ceo");
      expect(GOVERNMENT_WORKFLOW.approvalMatrix.critical.approvers).toContain("ciso");
    });
  });

  describe("Banking Compliance Template", () => {
    it("7. has correct name and description", () => {
      expect(BANKING_COMPLIANCE.name).toBe("Banking Compliance");
      expect(BANKING_COMPLIANCE.description).toContain("PCI-DSS");
      expect(BANKING_COMPLIANCE.description).toContain("SOX");
    });

    it("8. has 5 policy rules", () => {
      expect(BANKING_COMPLIANCE.rules.length).toBe(5);
    });

    it("9. allows file writes", () => {
      const engine = new PolicyEngine();
      BANKING_COMPLIANCE.rules.forEach((r) => engine.addPolicy(r));
      const decision = engine.evaluate("ceo", "write_file", {
        riskLevel: "low",
        delegationDepth: 0,
        timestamp: new Date().toISOString(),
      });
      expect(decision.allowed).toBe(true);
    });

    it("10. requires dual approval for external operations", () => {
      const engine = new PolicyEngine();
      BANKING_COMPLIANCE.rules.forEach((r) => engine.addPolicy(r));
      const decision = engine.evaluate("ceo", "git_push", {
        riskLevel: "high",
        delegationDepth: 0,
        timestamp: new Date().toISOString(),
      });
      expect(decision.effect).toBe("require_approval");
    });

    it("11. denies shell execution", () => {
      const engine = new PolicyEngine();
      BANKING_COMPLIANCE.rules.forEach((r) => engine.addPolicy(r));
      const decision = engine.evaluate("ceo", "exec_command", {
        riskLevel: "critical",
        delegationDepth: 0,
        timestamp: new Date().toISOString(),
      });
      expect(decision.allowed).toBe(false);
    });

    it("12. has CFO in critical approval matrix", () => {
      expect(BANKING_COMPLIANCE.approvalMatrix.critical.approvers).toContain("cfo");
      expect(BANKING_COMPLIANCE.approvalMatrix.critical.minApprovals).toBe(2);
    });
  });

  describe("Enterprise Onboarding", () => {
    it("13. runs onboarding and returns success", async () => {
      const onboarding = new EnterpriseOnboarding();
      const result = await onboarding.runOnboarding({
        orgName: "TestCorp",
        industry: "Technology",
        teamSize: "10-50",
        complianceRequirements: ["SOC2"],
        governanceTemplate: "strict",
      });

      expect(result.success).toBe(true);
      expect(result.orgDetails.orgName).toBe("TestCorp");
      expect(result.templateName).toBe("strict");
      expect(result.identityConfigured).toBe(true);
      expect(result.auditConfigured).toBe(true);
      expect(result.dashboardConfigured).toBe(true);
      expect(result.timestamp).toBeDefined();
    });

    it("14. preserves all org details in result", async () => {
      const onboarding = new EnterpriseOnboarding();
      const result = await onboarding.runOnboarding({
        orgName: "AcmeInc",
        industry: "Finance",
        teamSize: "50-200",
        complianceRequirements: ["PCI-DSS", "SOX"],
        governanceTemplate: "banking",
        dashboardPort: 8080,
      });

      expect(result.orgDetails.industry).toBe("Finance");
      expect(result.orgDetails.complianceRequirements).toContain("PCI-DSS");
      expect(result.orgDetails.dashboardPort).toBe(8080);
    });
  });

  describe("White-Label Configuration", () => {
    it("15. creates config with org name", () => {
      const config = createWhiteLabelConfig("AcmeCorp");
      expect(config.orgName).toBe("AcmeCorp");
      expect(config.dashboardTitle).toContain("AcmeCorp");
      expect(config.welcomeMessage).toContain("AcmeCorp");
    });

    it("16. defaults to default template", () => {
      const config = createWhiteLabelConfig("TestOrg");
      expect(config.template).toBe("default");
    });

    it("17. supports template selection", () => {
      const config = createWhiteLabelConfig("GovOrg", "government");
      expect(config.template).toBe("government");
    });

    it("18. enables identity, governance, audit, memory by default", () => {
      const config = createWhiteLabelConfig("TestOrg");
      expect(config.enabledFeatures.identity).toBe(true);
      expect(config.enabledFeatures.governance).toBe(true);
      expect(config.enabledFeatures.audit).toBe(true);
      expect(config.enabledFeatures.memory).toBe(true);
    });

    it("19. disables security and marketplace by default", () => {
      const config = createWhiteLabelConfig("TestOrg");
      expect(config.enabledFeatures.security).toBe(false);
      expect(config.enabledFeatures.marketplace).toBe(false);
    });

    it("20. has branding defaults", () => {
      const config = createWhiteLabelConfig("TestOrg");
      expect(config.primaryColor).toBeDefined();
      expect(config.secondaryColor).toBeDefined();
    });
  });
});
