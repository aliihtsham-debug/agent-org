export interface AgentIdentity {
  agentId: string;
  publicKey: string;
  createdAt: string;
  expiresAt?: string;
  metadata: AgentIdentityMetadata;
}

export interface AgentIdentityMetadata {
  role: string;
  displayName: string;
  version: string;
}

export interface AgentKeyPair {
  publicKey: string;
  privateKey: string;
}

export interface AgentRegistration {
  did: string;
  document: AgentDIDDocument;
  registeredAt: string;
  status: "active" | "revoked" | "rotated";
}

export interface AgentDIDDocument {
  "@context": string;
  id: string;
  verificationMethod: AgentVerificationMethod[];
  authentication: string[];
}

export interface AgentVerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase: string;
}

export interface DelegationCredentialProof {
  type: string;
  created: string;
  verificationMethod: string;
  proofPurpose: string;
  proofValue: string;
}

export interface DelegationCredentialSubject {
  id: string;
  role: string;
  scope: string[];
}

export interface DelegationCredential {
  issuer: string;
  issuanceDate: string;
  credentialSubject: DelegationCredentialSubject;
  proof: DelegationCredentialProof;
}

export interface IdentityContext {
  identity: AgentIdentity;
  signingKey: CryptoKey;
}
