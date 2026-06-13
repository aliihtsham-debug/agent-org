import type { ReviewPair } from "../types/agent-types.js";

/**
 * Default cross-functional review pairs for Phase 6 iterative refinement.
 *
 * Each pair defines a reviewer → reviewee relationship with a specific focus.
 * These are high-value cross-functional checks that catch issues the single-pass
 * tree misses (e.g., security reviewing architecture, QA reviewing API design).
 */
export const DEFAULT_REVIEW_PAIRS: ReviewPair[] = [
  {
    reviewer: "security-auditor",
    reviewee: "cto",
    reviewFocus:
      "Security flaws, threat vectors, and missing security controls in the architecture and system design",
    maxIterations: 1,
  },
  {
    reviewer: "security-auditor",
    reviewee: "backend-engineer",
    reviewFocus:
      "API security issues: authentication, authorization, input validation, injection risks, data exposure",
    maxIterations: 1,
  },
  {
    reviewer: "testing-agent",
    reviewee: "backend-engineer",
    reviewFocus:
      "Testability of the API design: missing edge cases, unclear contracts, untestable patterns, missing error handling",
    maxIterations: 1,
  },
  {
    reviewer: "testing-agent",
    reviewee: "frontend-engineer",
    reviewFocus:
      "Testability of the component scaffold: missing test IDs, tight coupling, untestable patterns, accessibility gaps",
    maxIterations: 1,
  },
  {
    reviewer: "ux-researcher",
    reviewee: "frontend-engineer",
    reviewFocus:
      "UX issues in the component scaffold: accessibility, information architecture, user flow problems, missing states",
    maxIterations: 1,
  },
  {
    reviewer: "cto",
    reviewee: "security-auditor",
    reviewFocus:
      "Technical feasibility and implementation cost of security recommendations",
    maxIterations: 1,
  },
  {
    reviewer: "pm",
    reviewee: "cto",
    reviewFocus:
      "Product feasibility: scope alignment, timeline realism, feature-architecture fit, MVP boundary concerns",
    maxIterations: 1,
  },
];
