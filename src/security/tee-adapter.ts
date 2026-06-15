/**
 * Phase 13 — TEE (Trusted Execution Environment) Adapter
 *
 * Adapter pattern for TEE-backed execution.
 * Local implementation simulates attestation.
 */

export interface AttestationReport {
  valid: boolean;
  timestamp: string;
  environment: string;
  measurements: Record<string, string>;
}

export interface TEEProvider {
  attest(): Promise<AttestationReport>;
  execute<T>(fn: () => Promise<T>): Promise<T>;
}

export class LocalTEEProvider implements TEEProvider {
  async attest(): Promise<AttestationReport> {
    return {
      valid: true,
      timestamp: new Date().toISOString(),
      environment: "local",
      measurements: {
        node_version: process.version,
        platform: process.arch,
        // In a real TEE, these would be hardware-backed measurements
        simulated: "true",
      },
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // In a real TEE, this would run inside the enclave
    return fn();
  }
}

export class IntelSGXAdapter implements TEEProvider {
  async attest(): Promise<AttestationReport> {
    console.log("[IntelSGXAdapter] SGX not available — returning invalid attestation");
    return {
      valid: false,
      timestamp: new Date().toISOString(),
      environment: "intel-sgx",
      measurements: { error: "SGX not available" },
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    console.log("[IntelSGXAdapter] SGX not available — executing outside enclave");
    return fn();
  }
}

export function createTEEProvider(type: "local" | "sgx" = "local"): TEEProvider {
  switch (type) {
    case "sgx":
      return new IntelSGXAdapter();
    default:
      return new LocalTEEProvider();
  }
}
