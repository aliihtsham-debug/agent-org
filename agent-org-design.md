# Agent Org Design Document

## Vision

A multi-agent system powered by the **Claude Agent SDK** where a **CEO Agent** receives a product idea or feature request, decomposes it, and delegates work across a full engineering organization of specialized sub-agents.

```
CEO Agent
├── CTO Agent
│   ├── Engineering Manager Agent
│   │   ├── Frontend Engineer Agent
│   │   ├── Backend Engineer Agent
│   │   ├── AI Engineer Agent
│   │   └── DevOps Agent
│   └── QA Manager Agent
│       ├── Testing Agent
│       └── Performance Agent
├── CISO Agent
│   ├── Security Auditor Agent
│   ├── Vulnerability Scanner Agent
│   └── Compliance Agent
├── Product Manager Agent
│   ├── UX Research Agent
│   ├── Roadmap Agent
│   └── Analytics Agent
├── CFO Agent
│   ├── Budget Agent
│   └── Pricing Agent
└── COO Agent
    ├── Scheduler Agent
    ├── Workflow Agent
    └── Monitoring Agent
```

## Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Agent SDK | Claude Agent SDK (`@anthropic-anthropic/agent-sdk`) | Native tool use, sub-agent spawning, prompt caching |
| Orchestration | Custom orchestration layer | CEO delegates to VPs, VPs delegate to managers, managers delegate to ICs |
| Runtime | Node.js (TypeScript) | Type safety, rich ecosystem, Agent SDK support |
| VCS | Git + GitHub | All agents commit to branches, open PRs |
| CI/CD | GitHub Actions | Automated testing, deployment pipelines |
| Optional UI | Web dashboard (Next.js) | Real-time agent activity, logs, approvals |

## Agent Roles & Responsibilities

### CEO Agent (Top-Level Orchestrator)
- **Input**: Product idea, feature request, or bug report from human
- **Responsibilities**:
  - Decompose the request into work streams (eng, product, security, finance, operations)
  - Spawn VP-level agents in parallel
  - Aggregate results and present a unified plan/backlog
  - Make go/no-go decisions at milestones
- **Tools**: Sub-agent spawning, file system, web search, git, Slack/email notifications
- **Output**: Project plan document, prioritized backlog, status reports

### CTO Agent (Technical Leadership)
- **Input**: Technical scope from CEO
- **Responsibilities**:
  - Architecture decisions and tech stack selection
  - Engineering resource allocation
  - Technical debt assessment
  - Delegates to Engineering Manager and QA Manager
- **Tools**: Code analysis, web search (tech docs), file system, diagram generation
- **Output**: Architecture Decision Records (ADRs), tech spec documents

### CISO Agent (Security)
- **Input**: System design from CTO, compliance requirements
- **Responsibilities**:
  - Security architecture review
  - Delegates to Security Auditor, Vulnerability Scanner, Compliance agents
  - Approves/denies deployments based on security posture
- **Tools**: Code scanning, dependency audit, compliance checklists
- **Output**: Security audit reports, vulnerability findings, compliance status

### Product Manager Agent
- **Input**: Product requirements from CEO
- **Responsibilities**:
  - User story writing and acceptance criteria
  - Feature prioritization (RICE/ICE framework)
  - Delegates to UX Research, Roadmap, and Analytics agents
- **Tools**: Web search (market research), file system, project management APIs
- **Output**: PRDs, user stories, prioritized backlog, roadmap

### CFO Agent (Financial)
- **Input**: Project scope and resource estimates
- **Responsibilities**:
  - Cost estimation for infrastructure, tooling, headcount
  - Delegates to Budget and Pricing agents
  - ROI analysis for features
- **Tools**: Web search (pricing data), spreadsheet generation, calculator
- **Output**: Budget proposals, cost breakdowns, pricing models

### COO Agent (Operations)
- **Input**: Project timeline and dependencies
- **Responsibilities**:
  - Sprint planning and scheduling
  - Workflow optimization
  - System monitoring and alerting setup
  - Delegates to Scheduler, Workflow, and Monitoring agents
- **Tools**: Calendar APIs, monitoring dashboards, CI/CD APIs
- **Output**: Project timelines, runbooks, monitoring configs

## Delegation Flow

```
Human gives idea to CEO
  │
  ├── CEO spawns CTO, PM, CISO, CFO, COO in parallel
  │
  ├── CTO spawns Eng Manager + QA Manager
  │     ├── Eng Manager spawns Frontend, Backend, AI, DevOps Engineers
  │     └── QA Manager spawns Testing + Performance agents
  │
  ├── PM spawns UX Research, Roadmap, Analytics
  ├── CISO spawns Security Auditor, Vuln Scanner, Compliance
  ├── CFO spawns Budget, Pricing
  └── COO spawns Scheduler, Workflow, Monitoring
```

## Communication Model

1. **Top-down delegation**: Parent agents spawn children with a clear task description, context, and expected output format
2. **Bottom-up reporting**: Children return structured results (JSON or markdown) to their parent
3. **Cross-functional sync**: VP-level agents can communicate through the CEO or directly for dependencies
4. **Human-in-the-loop**: CEO presents milestone summaries to the human for approval before proceeding

## Project Structure

```
agent-org/
├── package.json
├── tsconfig.json
├── .env
├── src/
│   ├── orchestrator/
│   │   └── ceo-agent.ts          # Top-level orchestrator
│   ├── agents/
│   │   ├── vp/
│   │   │   ├── cto-agent.ts
│   │   │   ├── ciso-agent.ts
│   │   │   ├── pm-agent.ts
│   │   │   ├── cfo-agent.ts
│   │   │   └── coo-agent.ts
│   │   ├── manager/
│   │   │   ├── eng-manager-agent.ts
│   │   │   └── qa-manager-agent.ts
│   │   └── ic/
│   │       ├── frontend-engineer.ts
│   │       ├── backend-engineer.ts
│   │       ├── ai-engineer.ts
│   │       ├── devops-agent.ts
│   │       ├── testing-agent.ts
│   │       ├── performance-agent.ts
│   │       ├── security-auditor.ts
│   │       ├── vuln-scanner.ts
│   │       ├── compliance-agent.ts
│   │       ├── ux-research.ts
│   │       ├── roadmap-agent.ts
│   │       ├── analytics-agent.ts
│   │       ├── budget-agent.ts
│   │       ├── pricing-agent.ts
│   │       ├── scheduler-agent.ts
│   │       ├── workflow-agent.ts
│   │       └── monitoring-agent.ts
│   ├── tools/
│   │   ├── file-tools.ts
│   │   ├── git-tools.ts
│   │   ├── web-tools.ts
│   │   └── code-tools.ts
│   ├── types/
│   │   └── agent-types.ts
│   └── prompts/
│       └── agent-prompts.ts       # All system prompts in one place
├── outputs/                       # Agent-generated artifacts
│   ├── architecture/
│   ├── specs/
│   ├── code/
│   ├── security/
│   └── reports/
└── tests/
    └── agent-tests.ts
```

## Implementation Phases

### Phase 1: Foundation (Week 1)
- Set up project scaffold (TypeScript, Agent SDK)
- Implement CEO Agent with sub-agent spawning
- Implement CTO Agent + Engineering Manager
- Implement one IC agent (Backend Engineer) end-to-end
- Define shared tool interfaces and types

### Phase 2: Engineering Branch (Week 2)
- Implement Frontend, AI, and DevOps Engineer agents
- Implement QA Manager + Testing + Performance agents
- Implement code review workflow between agents
- Git integration (branch per agent, PR workflow)

### Phase 3: Cross-Functional (Week 3)
- Implement Product Manager + sub-agents
- Implement CISO + sub-agents
- Implement CFO + sub-agents
- Implement COO + sub-agents

### Phase 4: Polish & Observability (Week 4)
- Web dashboard for real-time agent activity
- Structured logging and artifact storage
- Human approval gates at milestones
- End-to-end test: give CEO a product idea, get a full project plan + initial code

## Key Design Decisions

1. **Each agent is a separate Agent SDK instance** — clean separation, independent context windows
2. **Shared tool library** — all agents use the same file/git/web tools, just with different permissions
3. **Prompt-driven behavior** — all system prompts live in `agent-prompts.ts` for easy iteration
4. **Artifact-based communication** — agents write outputs to `outputs/` directory, parents read from there
5. **Deterministic delegation tree** — the org chart is fixed, not dynamically generated (simpler, more predictable)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Token/cost explosion with 20+ agents | Use Haiku 4.5 for IC agents, reserve Sonnet/Opus for VP+ levels |
| Agents going off-track | Strict output schemas, validation in parent agents |
| Circular dependencies between agents | Strict top-down delegation, no lateral spawning |
| Slow execution from sequential spawning | Spawn independent agents in parallel where possible |
| Code quality from AI agents | Mandatory code review step, linting in CI, human approval gates |
