import Anthropic from "@anthropic-ai/sdk";
import type { AgentRole, AgentResult, TaskSpec, AgentStatus } from "../types/agent-types.js";
import { getSystemPrompt } from "../prompts/agent-prompts.js";
import { writeOutput, readFileIfExists, ensureDir } from "../tools/file-tools.js";
import { AgentLogger } from "../observability/logger.js";
import { webSearch, webFetch } from "../tools/web-tools.js";

// OpenRouter model IDs — uses free-tier models on OpenRouter (OWL / openrouter/auto)
// Format: "openrouter/<provider>/<model>" or alias "openrouter/auto" for OWL router
const MODEL_MAP: Record<AgentRole, string> = {
  ceo: "openrouter/auto",        // OWL routes to best available model
  cto: "openrouter/auto",
  pm: "openrouter/auto",
  "frontend-engineer": "openrouter/auto",
  "backend-engineer": "openrouter/auto",
  "testing-agent": "openrouter/auto",
  "security-auditor": "openrouter/auto",
  "devops-agent": "openrouter/auto",
};

// Per-agent max_tokens — orchestrators get more room for synthesis,
// IC agents get enough for focused deliverables without over-generating.
const MAX_TOKENS_MAP: Record<AgentRole, number> = {
  ceo: 8192,
  cto: 8192,
  pm: 8192,
  "frontend-engineer": 6000,
  "backend-engineer": 6000,
  "testing-agent": 5000,
  "security-auditor": 5000,
  "devops-agent": 5000,
};

export interface AgentContext {
  apiKey: string;
  baseURL: string;
  outputBase: string;
  logger: AgentLogger;
  /** The role of the agent that spawned this one (for logging) */
  parentRole: AgentRole;
  /** Read artifacts produced by other agents for cross-referencing */
  readArtifact: (path: string) => Promise<string | null>;
  /** Git working directory for branch/commit operations */
  projectRoot: string;
  /** Whether this agent should perform web research before its task */
  enableWebTools: boolean;
}

/**
 * Perform a quick web search and return results as a context string.
 * Returns empty string if web tools are unavailable.
 */
async function gatherWebResearch(topic: string): Promise<string> {
  try {
    const query = topic.length > 120 ? topic.slice(0, 120) : topic;
    const results = webSearch(query);
    if (!results || results === "Search unavailable." || results === "No search results found.") {
      return "";
    }
    return `\n\n## Web Research\n${results}`;
  } catch {
    return "";
  }
}

export async function runAgent(
  spec: TaskSpec,
  ctx: AgentContext,
): Promise<AgentResult> {
  const startTime = Date.now();
  const model = MODEL_MAP[spec.role];

  ctx.logger.spawn(ctx.parentRole, spec.role);

  try {
    const client = new Anthropic({
      apiKey: ctx.apiKey,
      baseURL: ctx.baseURL,
    });

    let contextFiles = "";
    if (spec.context) {
      contextFiles = `\n\n## Additional Context\n${spec.context}`;
    }
    if (spec.previousError) {
      contextFiles += `\n\n## Previous Attempt Error\n${spec.previousError}\n\nPlease fix the issue and try again.`;
    }

    // Append web research for agents that benefit from it
    if (ctx.enableWebTools) {
      const webContext = await gatherWebResearch(spec.task);
      if (webContext) {
        contextFiles += webContext;
        ctx.logger.info(`${spec.role} gathered web research`);
      }
    }

    const userMessage = `${spec.task}${contextFiles}\n\nWrite all output files to: ${spec.outputPath}`;

    const maxTokens = MAX_TOKENS_MAP[spec.role] ?? 8192;

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: getSystemPrompt(spec.role),
      messages: [{ role: "user", content: userMessage }],
    });

    const textBlocks = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    await ensureDir(spec.outputPath);
    const outputFile = `${spec.outputPath}/output.md`;
    await writeOutput(outputFile, textBlocks);

    const jsonMatch = textBlocks.match(/```json\s*([\s\S]*?)\s*```/);
    let summary = "Completed";
    let artifacts: string[] = [outputFile];

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        summary = parsed.summary ?? summary;
        if (Array.isArray(parsed.artifacts)) {
          artifacts = parsed.artifacts.map((a: string) =>
            a.startsWith("/") ? a : `${spec.outputPath}/${a}`
          );
        }
      } catch {
        // JSON parse failed — use defaults
      }
    }

    const durationMs = Date.now() - startTime;

    ctx.logger.complete(spec.role, summary);

    return {
      role: spec.role,
      status: "completed",
      outputPath: spec.outputPath,
      summary,
      artifacts,
      tokenUsage: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
      durationMs,
    };
  } catch (error: unknown) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.logger.fail(spec.role, errorMessage);

    return {
      role: spec.role,
      status: "failed",
      outputPath: spec.outputPath,
      summary: `Failed: ${errorMessage}`,
      artifacts: [],
      tokenUsage: { input: 0, output: 0 },
      durationMs,
      error: errorMessage,
    };
  }
}

export async function runAgentWithRetry(
  spec: TaskSpec,
  ctx: AgentContext,
  maxRetries = 1,
): Promise<AgentResult> {
  let result = await runAgent(spec, ctx);

  if (result.status === "failed" && (spec.retryCount ?? 0) < maxRetries) {
    ctx.logger.retry(spec.role, (spec.retryCount ?? 0) + 1);
    const retrySpec: TaskSpec = {
      ...spec,
      retryCount: (spec.retryCount ?? 0) + 1,
      previousError: result.error,
    };
    result = await runAgent(retrySpec, ctx);
  }

  return result;
}
