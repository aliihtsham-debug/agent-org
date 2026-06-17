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

const TEMPLATE_DEFAULTS: Record<WhiteLabelConfig["template"], Partial<WhiteLabelConfig>> = {
  default: {
    primaryColor: "#3b82f6",
    secondaryColor: "#8b5cf6",
  },
  strict: {
    primaryColor: "#1e3a5f",
    secondaryColor: "#3b82f6",
  },
  government: {
    primaryColor: "#1a365d",
    secondaryColor: "#2b6cb0",
  },
  banking: {
    primaryColor: "#0d4f3c",
    secondaryColor: "#16a34a",
  },
  startup: {
    primaryColor: "#7c3aed",
    secondaryColor: "#ec4899",
  },
};

export function createWhiteLabelConfig(
  orgName: string,
  template: WhiteLabelConfig["template"] = "default",
): WhiteLabelConfig {
  const defaults = TEMPLATE_DEFAULTS[template] ?? TEMPLATE_DEFAULTS.default;
  return {
    orgName,
    primaryColor: defaults.primaryColor ?? "#3b82f6",
    secondaryColor: defaults.secondaryColor ?? "#8b5cf6",
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
