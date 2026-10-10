// Which connector tools a reply loads (ADR 0005, ADR 0006). While the
// user's connector tools fit TOOL_BUDGET_TOKENS, every tool loads. Above
// it, the thread defers. Mentioned connectors load, and every other
// connector tool is sent deferred, for the model to find with Anthropic's
// tool search.

import type { ModelMessage, StepResult, Tool, ToolSet } from "ai";
import { findConnectorTool, type Connector } from "./connectors";

/**
 * About how many tokens of connector tool definitions a reply loads. Above
 * this, the thread defers connector tools. estimateToolTokens puts
 * Notion's 12 tools at about 32k, so Notion alone loads, and Notion with
 * any other connector defers.
 */
export const TOOL_BUDGET_TOKENS = 35_000;

/**
 * The most mentioned connectors whose tools a reply that searches tools
 * loads. Other mentioned connectors are deferred like the rest.
 */
const MAX_LOADED_MENTIONS = 3;

/** The search tool's key in the tool set. Saved search parts use it. */
export const TOOL_SEARCH_KEY = "toolSearch";

/**
 * How a reply offers connector tools:
 * - `all`: every tool loads.
 * - `search`: mentioned connectors load, and the rest are deferred.
 */
export type ToolLoading = "all" | "search";

/** One connection's tools in a reply. */
export type ConnectorToolGroup = {
  connector: Connector;
  /** Named by modelToolName. */
  tools: ToolSet;
  /** About how many tokens the tools' definitions take (estimateToolTokens). */
  estimatedTokens: number;
};

/**
 * About how many tokens a tool definition takes, counting 4 characters of
 * its JSON as a token. It's a rough count, close enough to compare with the
 * budget.
 */
export function estimateToolTokens(definition: {
  name: string;
  description?: string;
  inputSchema: unknown;
}): number {
  return Math.ceil(JSON.stringify(definition).length / 4);
}

/**
 * The reply's tools. With `deferred` false, every connector tool loads,
 * the mentioned connectors' first. With `deferred` true, the first
 * MAX_LOADED_MENTIONS mentioned connectors load, and every other connector
 * tool is sent deferred with `toolSearch`, its description starting with
 * the connector's name in brackets, so search can match terse names. When
 * no connector is left over, loading is `all`. Native tools always load.
 */
export function arrangeReplyTools({
  nativeTools,
  groups,
  mentioned,
  deferred,
  toolSearch,
}: {
  nativeTools: ToolSet;
  groups: ConnectorToolGroup[];
  mentioned: Connector[];
  deferred: boolean;
  toolSearch: Tool;
}): { tools: ToolSet; loading: ToolLoading } {
  const isMentioned = (group: ConnectorToolGroup) =>
    mentioned.includes(group.connector);
  const mentionedGroups = groups.filter(isMentioned);
  const otherGroups = groups.filter((group) => !isMentioned(group));
  const toolsOf = (list: ConnectorToolGroup[]): ToolSet =>
    Object.assign({}, ...list.map((group) => group.tools));

  if (!deferred) {
    return {
      tools: {
        ...toolsOf(mentionedGroups),
        ...nativeTools,
        ...toolsOf(otherGroups),
      },
      loading: "all",
    };
  }
  const loaded = mentionedGroups.slice(0, MAX_LOADED_MENTIONS);
  const tools = { ...toolsOf(loaded), ...nativeTools };
  if (loaded.length === groups.length) return { tools, loading: "all" };
  const deferredTools = groups
    .filter((group) => !loaded.includes(group))
    .flatMap((group) =>
      Object.entries(group.tools).map(
        ([name, tool]) =>
          [name, deferTool(group.connector, tool)] as const,
      ),
    );
  return {
    tools: {
      ...tools,
      [TOOL_SEARCH_KEY]: toolSearch,
      ...Object.fromEntries(deferredTools),
    },
    loading: "search",
  };
}

/**
 * The tool, sent with Anthropic's `deferLoading`. Not the AI SDK's own
 * `deferLoading`, which is for its toolSearch().
 */
function deferTool(connector: Connector, tool: Tool): Tool {
  // Spreading loses which kind of Tool this is, so TypeScript needs the cast.
  return {
    ...tool,
    description: `[${connector.name}] ${tool.description ?? ""}`.trimEnd(),
    providerOptions: {
      ...tool.providerOptions,
      anthropic: { ...tool.providerOptions?.anthropic, deferLoading: true },
    },
  } as Tool;
}

/**
 * The messages with each tool search result cut down to the tools the
 * reply offers. Anthropic rejects a request whose history references a
 * tool it doesn't define, which happens after a disconnect or an allowlist
 * change. References to tools still offered stay, because they keep those
 * tools loaded for the model. Messages with nothing to cut come back as
 * they are.
 *
 * A search result is the tool-result of a tool-call marked
 * `providerExecuted`. The result itself has no such mark.
 */
export function dropGoneToolReferences(
  messages: ModelMessage[],
  offered: ReadonlySet<string>,
): ModelMessage[] {
  const searchCallIds = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant" || typeof message.content === "string") {
      continue;
    }
    for (const part of message.content) {
      if (part.type === "tool-call" && part.providerExecuted) {
        searchCallIds.add(part.toolCallId);
      }
    }
  }
  if (searchCallIds.size === 0) return messages;

  return messages.map((message) => {
    if (message.role !== "assistant" && message.role !== "tool") return message;
    if (typeof message.content === "string") return message;
    let changed = false;
    const content = message.content.map((part) => {
      if (
        part.type !== "tool-result" ||
        !searchCallIds.has(part.toolCallId) ||
        part.output.type !== "json" ||
        !Array.isArray(part.output.value)
      ) {
        return part;
      }
      const kept = part.output.value.filter(
        (reference) => !isGoneReference(reference, offered),
      );
      if (kept.length === part.output.value.length) return part;
      changed = true;
      return { ...part, output: { ...part.output, value: kept } };
    });
    return changed ? ({ ...message, content } as ModelMessage) : message;
  });
}

function isGoneReference(
  reference: unknown,
  offered: ReadonlySet<string>,
): boolean {
  const name = referencedToolName(reference);
  return name !== undefined && !offered.has(name);
}

/** The tool a search result's reference names, if it's a reference. */
function referencedToolName(reference: unknown): string | undefined {
  if (typeof reference !== "object" || reference === null) return undefined;
  const { type, toolName } = reference as { type?: unknown; toolName?: unknown };
  return type === "tool_reference" && typeof toolName === "string"
    ? toolName
    : undefined;
}

/**
 * What one reply did with its tools, for its log line (ADR 0006). Feed it
 * each step and each tool run, then print it once the reply ends.
 */
export class ReplyToolLog {
  private readonly searches: { query: unknown; found: string[] }[] = [];
  private readonly called: string[] = [];
  private readonly connectorErrors: Record<string, string[]> = {};
  private readonly pausedSteps: number[] = [];
  private steps = 0;

  constructor(
    private readonly threadId: string,
    private readonly deferred: boolean,
    private readonly loading: ToolLoading,
    private readonly groups: ConnectorToolGroup[],
  ) {}

  /** Logs the step's searches and the tools the model called in it. */
  addStep(step: StepResult<ToolSet>) {
    this.steps += 1;
    const queries = new Map<string, unknown>();
    for (const part of step.content) {
      if (part.type === "tool-call") {
        if (part.toolName === TOOL_SEARCH_KEY) {
          queries.set(part.toolCallId, (part.input as { query?: unknown }).query);
        } else {
          this.called.push(part.toolName);
        }
      } else if (
        part.type === "tool-result" &&
        part.toolName === TOOL_SEARCH_KEY
      ) {
        this.searches.push({
          query: queries.get(part.toolCallId),
          found: Array.isArray(part.output)
            ? part.output.flatMap((reference: unknown) => {
                const name = referencedToolName(reference);
                return name === undefined ? [] : [name];
              })
            : [],
        });
      }
    }
    // @ai-sdk/anthropic reports pause_turn as "stop", which ends the reply.
    if (step.rawFinishReason === "pause_turn") this.pausedSteps.push(this.steps);
  }

  /**
   * Logs a connector tool that failed. This sees every run, including an
   * approved action that runs before a continuation's first step.
   */
  addToolRun({
    toolCall,
    toolOutput,
  }: {
    toolCall: { toolName: string };
    toolOutput: { type: string; error?: unknown };
  }) {
    if (toolOutput.type !== "tool-error") return;
    const connector = findConnectorTool(toolCall.toolName)?.connector;
    if (!connector) return;
    const { error } = toolOutput;
    (this.connectorErrors[connector.name] ??= []).push(
      error instanceof Error ? error.message : String(error),
    );
  }

  print() {
    console.log("reply tools", {
      threadId: this.threadId,
      deferred: this.deferred,
      loading: this.loading,
      estimatedToolTokens: Object.fromEntries(
        this.groups.map((group) => [
          group.connector.name,
          group.estimatedTokens,
        ]),
      ),
      steps: this.steps,
      searches: this.searches,
      toolsCalled: this.called,
      connectorErrors: this.connectorErrors,
      ...(this.pausedSteps.length > 0 ? { pausedSteps: this.pausedSteps } : {}),
    });
  }
}
