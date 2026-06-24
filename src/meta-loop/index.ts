// ── Meta-Loop Barrel Export ────────────────────────────────────────────
// Public API for the self-evolving meta-loop. Import from `src/meta-loop`
// to access meta-loop functionality.

export type {
  RunSummary,
  ProposedChange,
  ProposalCategory,
  ProposalStatus,
  SignalWindow,
  RoleWindow,
  PairWindow,
  MetaLoopConfig,
  RoleMetric,
} from "../types/meta-types.js";

export { DEFAULT_META_LOOP_CONFIG } from "../types/meta-types.js";
export { loadMetaConfig, saveMetaConfig, metaConfigPath, validateConfig } from "./meta-config.js";
export { createLedger } from "./ledger.js";
export type { Ledger, LedgerEntry } from "./ledger.js";
export { collectRunSignals, readProjectPlan, readAgentEvents, readArtifactManifest, readCritiques } from "./run-collector.js";
export { readLastNRuns, aggregateRuns } from "./aggregator.js";
export { createFindingStore, generateFindingId } from "./finding-store.js";
export type { FindingStore, FindingRecord } from "./finding-store.js";
export { createVersionStore } from "./version-store.js";
export type { VersionStore } from "./version-store.js";
export { evaluateAllRules, ALL_PROPOSER_RULES } from "./proposer-rules.js";
export type { ProposerRule, ProposerContext } from "./proposer-rules.js";
export { evaluateAndApply, rollbackProposal, getMetaStatus } from "./meta-orchestrator.js";
export type { MetaOrchestratorOptions } from "./meta-orchestrator.js";
export { applyPromptEdit } from "./prompt-editor.js";
export { applyGovernanceEdit } from "./governance-editor.js";
export { applyCEOConfigEdit, TUNABLE_LEVERS } from "./ceo-config-editor.js";
export type { TunableLever } from "./ceo-config-editor.js";
