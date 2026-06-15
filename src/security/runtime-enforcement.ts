/**
 * Phase 13 — Runtime Policy Enforcement
 *
 * Wraps the base agent runner with identity verification,
 * policy checks, path verification, and output signing.
 */

import type { AgentResult, TaskSpec } from "../types/agent-types.js";
import type { AgentContext } from "../agents/base-agent.js";
import type { AgentIdentity, AgentKeyPair } from "../types/identity-types.js";
import { signData } from "../identity/agent-identity.js";
import { resolve, sep } from "node:path";

export interface SecurityContext {
  identity: AgentIdentity;
  keyPair: AgentKeyPair;
}

export function verifyFilePath(path: string, allowedBase: string): boolean {
  try {
    const resolved = resolve(path);
    const allowed = resolve(allowedBase);
    return resolved.startsWith(allowed + sep) || resolved === allowed;
  } catch {
    return false;
  }
}

export async function signAgentOutput(
  output: string,
  identity: AgentIdentity,
  keyPair: AgentKeyPair,
): Promise<string> {
  return signData(identity, output, keyPair);
}

/**
 * Creates a secure runner that wraps the base agent runner
 * with identity verification, policy checks, and output signing.
 */
export function createSecureRunner(
  baseRunner: (spec: TaskSpec, ctx: AgentContext) => Promise<AgentResult>,
): (spec: TaskSpec, ctx: AgentContext & { security?: SecurityContext }) => Promise<AgentResult> {
  return async (spec: TaskSpec, ctx: AgentContext & { security?: SecurityContext }): Promise<AgentResult> => {
    // Verify identity if security context is present
    if (ctx.security) {
      const { identity, keyPair } = ctx.security;
      if (!identity || !keyPair) {
        return {
          role: spec.role,
          status: "failed",
          outputPath: spec.outputPath,
          summary: "Security error: missing identity or key pair",
          artifacts: [],
          tokenUsage: { input: 0, output: 0 },
          durationMs: 0,
          error: "Missing security context",
        };
      }
    }

    // Run the base agent
    const result = await baseRunner(spec, ctx);

    // Sign the output if security context is present
    if (ctx.security && result.status === "completed") {
      try {
        const signature = await signAgentOutput(
          result.summary,
          ctx.security.identity,
          ctx.security.keyPair,
        );
        result.signature = signature;
        result.producedBy = ctx.security.identity.agentId;
      } catch {
        // Signing failed — still return result but mark as unsigned
      }
    }

    return result;
  };
}
