# Agent Org — Quick Start

## Prerequisites
- Node.js ≥ 22
- OpenRouter API key ([get one](https://openrouter.ai/keys))
- Optional: Linear API key for project sync

## Install & Run

```bash
git clone https://github.com/aliihtsham-debug/agent-org
cd agent-org
npm install

# Dev mode (no build)
npx tsx src/index.ts "Your product idea"

# Production mode
npm run build && npm start -- "Your product idea"
```

## Minimal Example

```bash
npx tsx src/index.ts "SaaS task management app with real-time collaboration"
```

Output appears in `outputs/`:
- `project-plan.md` — unified human-readable plan
- `project-plan.json` — machine-readable plan
- `specs/`, `architecture/`, `code/`, `tests/`, `security/`, `finance/`, `operations/` — per-agent artifacts

## Common Flags

| Flag | Purpose |
|------|---------|
| `--dashboard [port]` | Live web dashboard (default 3001) |
| `--approve` | Pause at milestones for human review |
| `--refine` | Cross-functional iterative refinement |
| `--full-enterprise` | All enterprise features (identity, governance, audit, security, memory, marketplace) |
| `--template <name>` | Governance template: `default` \| `strict` \| `government` \| `banking` |
| `--meta <mode>` | Self-evolving meta-loop: `advisory` \| `capture` \| `propose` \| `apply` \| `auto` |

## Environment (`.env`)

```env
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1  # optional
LINEAR_API_KEY=lin_api_...                         # optional
DASHBOARD_TOKEN=your-secret                        # optional, enables dashboard auth
```

## Linear Sync

Set `LINEAR_API_KEY` in `.env` — sync happens automatically on run completion. Creates: project, labels, cycles (sprints), issues (user stories, security findings, deliverables).

## Dashboard

```bash
# With real run
npx tsx src/index.ts "idea" --dashboard 3001

# Mock mode (no API key needed)
npx tsx src/dashboard/mock-run.ts 3001
```
Open http://localhost:3001

## Meta-Loop CLI

```bash
npx tsx src/meta-cli.ts status          # pending + applied proposals
npx tsx src/meta-cli.ts rollback <id>   # revert a proposal
npx tsx src/meta-cli.ts history --runs 20
npx tsx src/meta-cli.ts config
```

## Test

```bash
npm test                    # all 320 tests
npx vitest --run tests/e2e.test.ts  # single file
```