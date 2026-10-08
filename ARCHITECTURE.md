# Agent Org — Architecture Reference

## Agent Hierarchy (26 Agents)

```
CEO
├── PM → UX Researcher, Roadmap Agent, Analytics Agent
├── CTO → Engineering Manager → Frontend, Backend, AI, DevOps
│            → QA Manager → Testing Agent, Performance Agent
├── CISO → Security Auditor, Vulnerability Scanner, Compliance Agent
├── CFO → Budget Agent, Pricing Agent
├── COO → Scheduler Agent, Workflow Agent, Monitoring Agent
└── Linear Mapper
```

## Core Orchestration Flow

```
main() → runCEOAgent()
  ├── spawn 5 VPs via Promise.allSettled
  │    ├── PM: runOrchestratorAgent() → spawn 3 ICs
  │    ├── CTO: runManagerOrchestratorAgent() → Eng Mgr + QA Mgr
  │    ├── CISO: runOrchestratorAgent() → spawn 3 ICs
  │    ├── CFO: runOrchestratorAgent() → spawn 2 ICs
  │    └── COO: runOrchestratorAgent() → spawn 3 ICs
  ├── collect results, commit to git branches
  └── write project-plan.md + project-plan.json
```

## Shared Helpers (`src/agents/base-agent.ts`)

| Function | Purpose |
|----------|---------|
| `runOrchestratorAgent()` | Generic VP orchestrator (PM, CFO, CISO, COO) |
| `runManagerOrchestratorAgent()` | Manager orchestrator (CTO) |
| `runAgentWithRetry()` | LLM call with error classification + backoff |
| `capOutput()` | Binary-search truncation at 512 KB |
| `extractJsonBlock()` | Parse ```json ... ``` from LLM output |

## Communication Model

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| Top-down | TaskSpec passed to child | Delegation with context |
| Bottom-up | `AgentResultsRegistry` (Map) | Direct parent→child result access |
| Lateral | `AgentMessageBus` | Targeted agent-to-agent messages |
| Events | `AgentEventEmitter` | Broadcast lifecycle events |
| Durable | Disk (`outputs/`) | Audit trail, artifact persistence |

**Registry key validation**: Role must exist in `ROLE_OUTPUT_DIR` (single source of truth).

## Iterative Refinement (Phase 6, `--refine`)

```
Review Phase (7 pairs in parallel) → Filter (minSeverity) → Refinement Phase (re-run flagged agents)
```

| Reviewer | Reviewee | Focus |
|----------|----------|-------|
| security-auditor | cto | Architecture security |
| testing-agent | backend-engineer | API testability |
| performance-agent | frontend-engineer | FE performance |
| security-auditor | ai-engineer | AI safety |
| compliance-agent | devops-agent | Deployment compliance |
| vulnerability-scanner | cto | Tech stack vulns |
| roadmap-agent | pm | Product feasibility |

Outputs: `outputs/refinement/summary.md`, `outputs/refinement/critiques/*.json`, `{agent}/refined/output.md`

## Linear Sync (Phase 7)

```
Linear Mapper Agent (reads all outputs) → linear-import.json → syncToLinear() (creates entities)
```

Entity mapping:
- Project ← `ProjectPlan.idea`
- Labels ← Agent roles + VP branches
- Cycles ← Scheduler sprint plan (max 3)
- Issues ← PM stories, security findings, IC deliverables
- Priority: RICE ≥12→Urgent, 8-11→High, 4-7→Medium, <4→Low

## Enterprise Phases (8-16)

| Phase | Flag | Module | Key Capability |
|-------|------|--------|----------------|
| 8 | `--identity` | `src/identity/` | Ed25519 keys, DID, delegation chain |
| 9 | `--governance` | `src/governance/` | Policy engine, RBAC, risk assessment |
| 10 | `--audit` | `src/audit/` | Hash-chained log, compliance reports |
| 11 | `--approve` | `src/approval/` | Multi-stage approval, human override |
| 12 | `--memory` | `src/memory/` | Persistent memory, reputation, checkpoints |
| 13 | `--security` | `src/security/` | TEE, secrets vault, zero-trust |
| 14 | `--dashboard` | `src/dashboard/` | SSE dashboard, health endpoint |
| 15 | `--template` | `src/templates/` | Gov/Banking/Strict/Default templates |
| 16 | `--marketplace` | `src/marketplace/` | Blueprints, agent packs, workflows |

Convenience: `--full-enterprise` enables all.

## Meta-Loop (`src/meta-loop/`)

```
RunSummary → SignalWindow (sliding) → 7 Proposer Rules → ProposedChange → Gate → Snapshot → Next run loads active config
```

### 7 Proposer Rules (pure functions)

| Rule | Trigger | Action |
|------|---------|--------|
| `rule_criticalFindingRepeats` | Same findingId ≥3 | Prompt edit for reviewee |
| `rule_lowFixAcceptance` | fixAcceptanceRate < 0.4 | Strengthen reviewer prompt |
| `rule_tokenSaturation` | tokenBudget > 0.85 | Tighten outputFormat |
| `rule_governanceDenialSpike` | ruleId fires ≥5 | Loosen condition level |
| `rule_reputationDecline` | reliability ↓≥10 pts | CEO config: +1 maxIterations |
| `rule_emptyOutput` | artifact size = 0 | Prompt edit for output format |
| `rule_severityTrendUp` | severityTrend rising | Add review pair |

### Safety Gates

- **advisory/capture/propose**: No `src/` writes
- **apply**: Interactive y/n per proposal
- **auto**: Requires `--meta=auto` + `AGENT_ORG_META_AUTO=1`, snapshots + rollback

## Security Model

| Threat | Mitigation |
|--------|------------|
| Prompt injection | User content marked as data in all prompts |
| Registry poisoning | Role validation, structure validation, 100K char cap |
| Output explosion | 512 KB/agent cap |
| SSRF | webFetch blocks private IPs, http/https only |
| Command injection | execFileSync with arg arrays |
| Path traversal | readArtifact confined to outputBase |
| Premature side effects | Gates run before git/Linear writes |

## Concurrency Control

- `Semaphore` (`src/utils/semaphore.ts`) limits LLM calls (`LLM_MAX_CONCURRENT`, default 8) and Linear API calls (`LINEAR_MAX_CONCURRENT`, default 3).

## Model Configuration

All agents use `openrouter/auto` by default. Override per-role in `MODEL_MAP` (`base-agent.ts`):
- CEO/VP/Linear Mapper: 8192 max tokens
- Managers: 6000
- Engineering ICs: 6000
- Other ICs: 5000

## Output Structure

```
outputs/
├── project-plan.md/json          # Unified plan
├── agent-events.jsonl            # Structured event log
├── artifact-manifest.json        # Artifact index
├── specs/                        # PM, UX, Roadmap, Analytics
├── architecture/                 # CTO, Eng Manager
├── code/                         # Frontend, Backend, AI, DevOps
├── tests/                        # QA Manager, Testing, Performance
├── security/                     # CISO, Auditor, Scanner, Compliance
├── finance/                      # CFO, Budget, Pricing
├── operations/                   # COO, Scheduler, Workflow, Monitoring
├── linear/mapper/                # Linear import JSON
└── .meta/                        # Meta-loop artifacts (with --meta)
```

## Testing

320 tests across 33 files. All external deps mocked:
- `@anthropic-ai/sdk`, `@linear/sdk`, web tools, git, dashboard
- Run: `npm test` or `npx vitest`