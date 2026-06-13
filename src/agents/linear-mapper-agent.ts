import type { AgentContext } from "./base-agent.js";
import type { AgentResultsRegistry } from "../communication/results-registry.js";
import type { AgentRole } from "../types/agent-types.js";
import type { LinearImport } from "../tools/linear-types.js";
import { runAgentWithRetry } from "./base-agent.js";
import { writeOutput, ensureDir } from "../tools/file-tools.js";
import type { LinearMapperResult } from "../tools/linear-types.js";

/**
 * Agent roles whose outputs should be read for Linear mapping.
 * Ordered by importance: PM/roadmap first (epics, stories), then scheduler (cycles),
 * then security (findings), then others (deliverables).
 */
const MAPPED_ROLES: AgentRole[] = [
  "pm",
  "roadmap-agent",
  "scheduler-agent",
  "cto",
  "security-auditor",
  "vuln-scanner",
  "frontend-engineer",
  "backend-engineer",
  "ai-engineer",
  "devops-agent",
  "testing-agent",
  "performance-agent",
  "compliance-agent",
  "budget-agent",
  "pricing-agent",
  "ux-researcher",
  "analytics-agent",
  "engineering-manager",
  "qa-manager",
  "coo",
  "workflow-agent",
  "monitoring-agent",
];

/**
 * Run the Linear Mapper Agent.
 *
 * This agent reads all agent outputs from the registry/disk, then produces a
 * structured `linear-import.json` file that the sync module can use to create
 * Linear entities via the API.
 *
 * The mapper agent itself does NOT call the Linear API — it only reads and
 * structures data. This keeps the API calls isolated in `linear-sync.ts`.
 */
export async function runLinearMapper(
  idea: string,
  ctx: AgentContext,
  registry: AgentResultsRegistry,
): Promise<LinearMapperResult> {
  const outputPath = `${ctx.outputBase}/linear/mapper`;

  // Build the list of agent outputs for the mapper to read
  const agentOutputs = buildAgentOutputList(idea, ctx, registry);

  const task = `You are the Linear Mapper Agent. Your job is to read all agent output files and produce a structured JSON file for Linear project management integration.

## Product Idea
"${idea}"

## Agent Output Files to Read
${agentOutputs}

## Instructions
1. Read each file listed above using the readArtifact tool or from disk.
2. Extract the following from each agent's output:
   - **PM**: User stories, feature backlog, RICE scores, MVP scope
   - **Roadmap Agent**: Epics, features, phased roadmap (Now/Next/Later), milestones
   - **Scheduler Agent**: Sprint plans, dependency graph, milestone timeline
   - **CTO**: Architecture decisions, technical risks
   - **Security Auditor**: Threat model findings, vulnerability severity
   - **Vulnerability Scanner**: Dependency audit findings
   - **IC Engineers** (Frontend, Backend, AI, DevOps): Deliverables, implementation notes
   - **QA**: Test strategy, quality targets
   - **Other agents**: Key deliverables and findings

3. Produce a JSON file with this exact structure:

\`\`\`json
{
  "projectName": "<the product idea>",
  "projectDescription": "<1-2 sentence CEO-level summary of the product>",
  "labels": ["pm", "cto", "security", "engineering", "qa", "product", "architecture"],
  "cycles": [
    {
      "name": "Sprint 1: <theme>",
      "startsAt": "<ISO date>",
      "endsAt": "<ISO date>"
    }
  ],
  "issues": [
    {
      "title": "<issue title>",
      "description": "<detailed description with acceptance criteria if available>",
      "labels": ["<role-label>"],
      "priority": "<urgent|high|medium|low|none>",
      "cycleName": "<sprint name if applicable>"
    }
  ],
  "metadata": {
    "agentCount": <number of agents>,
    "tokenUsage": { "input": <total>, "output": <total> },
    "durationMs": <total ms>,
    "timestamp": "<ISO timestamp>",
    "icSummaries": [
      { "role": "<role>", "summary": "<brief summary>" }
    ]
  }
}
\`\`\`

## Priority Mapping
- RICE score >= 12 → "urgent"
- RICE score 8-11 → "high"
- RICE score 4-7 → "medium"
- RICE score < 4 → "low"
- Security critical → "urgent"
- Security high → "high"
- Security medium → "medium"
- Security low → "low"

## Label Mapping
Use these labels based on the agent that produced the content:
- PM content → "pm", "product"
- CTO/architecture → "cto", "architecture"
- Engineering ICs → "engineering"
- Security → "security"
- QA → "qa"
- CFO/finance → "finance"
- COO/operations → "operations"

## Cycle Creation
- Create up to 3 cycles from the scheduler agent's sprint plan
- Each cycle should be 2-4 weeks
- Start dates should be sequential (Sprint 1 starts ~today, Sprint 2 after Sprint 1 ends, etc.)
- If no scheduler output is available, create a single "Sprint 1: Foundation" cycle

## Issue Creation Rules
- Create at least 1 issue per agent deliverable
- User stories from PM should each be a separate issue
- Security findings should each be a separate issue
- Architecture decisions can be 1-2 issues summarizing key decisions
- Each issue must have: title, description, at least 1 label, and priority

Write the JSON file to: ${outputPath}/linear-import.json`;

  const mapperSpec = {
    id: `linear-mapper-${Date.now()}`,
    role: "linear-mapper" as const,
    task,
    context: "",
    outputPath,
  };

  const mapperCtx: AgentContext = {
    ...ctx,
    parentRole: "ceo",
    enableWebTools: false,
  };

  const result = await runAgentWithRetry(mapperSpec, mapperCtx);

  if (result.status === "failed") {
    return {
      success: false,
      import: null,
      outputPath: `${outputPath}/linear-import.json`,
      error: result.error ?? "Mapper agent failed",
    };
  }

  // Read the produced output — runAgent writes to output.md, but the mapper
  // task prompt instructs the LLM to also write linear-import.json.
  // Try the explicit JSON file first, then fall back to output.md.
  try {
    const { readFileIfExists } = await import("../tools/file-tools.js");
    let content = await readFileIfExists(`${outputPath}/linear-import.json`);
    if (!content) {
      content = await readFileIfExists(`${outputPath}/output.md`);
    }
    if (!content) {
      return {
        success: false,
        import: null,
        outputPath: `${outputPath}/linear-import.json`,
        error: "Mapper agent produced no output file",
      };
    }

    // Try to extract JSON from the output
    let parsed: LinearImport;
    try {
      // Try parsing the whole content as JSON first
      parsed = JSON.parse(content) as LinearImport;
    } catch {
      // Try extracting from a JSON code block
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]) as LinearImport;
      } else {
        throw new Error("No valid JSON found in mapper output");
      }
    }

    // Validate required fields
    if (!parsed.projectName || !Array.isArray(parsed.issues)) {
      return {
        success: false,
        import: null,
        outputPath: `${outputPath}/linear-import.json`,
        error: "Mapper agent produced invalid JSON structure",
      };
    }

    return {
      success: true,
      import: parsed,
      outputPath: `${outputPath}/linear-import.json`,
    };
  } catch (err) {
    return {
      success: false,
      import: null,
      outputPath: `${outputPath}/linear-import.json`,
      error: `Failed to parse mapper output: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Build a human-readable list of agent output paths for the mapper agent.
 */
function buildAgentOutputList(
  idea: string,
  ctx: AgentContext,
  registry: AgentResultsRegistry,
): string {
  const lines: string[] = [];

  for (const role of MAPPED_ROLES) {
    const result = registry.get(role);
    if (!result || result.status === "failed") continue;

    // Use the first artifact (usually output.md)
    const artifact = result.artifacts[0];
    if (artifact) {
      lines.push(`- **${role}**: ${artifact} — ${result.summary.slice(0, 100)}`);
    }
  }

  return lines.length > 0
    ? lines.join("\n")
    : "No agent outputs available — create a minimal import from the product idea.";
}
