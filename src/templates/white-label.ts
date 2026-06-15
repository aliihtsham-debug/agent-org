/**
 * Phase 15 — White-Label Deployment Configuration
 */

export interface WhiteLabelConfig {
  orgName: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl?: string;
  faviconUrl?: string;
  dashboardTitle: string;
  welcomeMessage: string;
  template: "default" | "strict" | "government" | "banking" | "startup";
  enabledFeatures: {
    identity: boolean;
    governance: boolean;
    audit: boolean;
    security: boolean;
    memory: boolean;
    marketplace: boolean;
  };
  customAgentRoles?: string[];
}

export function createWhiteLabelConfig(
  orgName: string,
  template: WhiteLabelConfig["template"] = "default",
): WhiteLabelConfig {
  return {
    orgName,
    primaryColor: "#3b82f6",
    secondaryColor: "#8b5cf6",
    dashboardTitle: `${orgName} — Agent Org`,
    welcomeMessage: `Welcome to ${orgName}'s AI Organization Platform`,
    template,
    enabledFeatures: {
      identity: true,
      governance: true,
      audit: true,
      security: false,
      memory: true,
      marketplace: false,
    },
  };
}
