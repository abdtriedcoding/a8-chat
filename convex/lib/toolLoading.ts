// Which connector tools a reply loads (ADR 0009, ADR 0006). While the
// user's connector tools fit TOOL_BUDGET_TOKENS, every tool loads. Above
// it, the thread defers. Mentioned connectors load, and every other
// connector tool is deferred, for the model to find with Anthropic's tool
// search on Claude or a8's own on other models (ADR 0016).

import type { ModelMessage, StepResult, Tool, ToolSet } from "ai";
import type { Connector } from "./connectors";
import { findConnectorTool, type ConnectorView } from "./connectorView";

/**
 * About how many tokens of connector tool definitions a reply loads. Above
 * this, the thread defers connector tools. estimateToolTokens puts
 * Notion's 12 tools at about 32k, so Notion alone loads, and Notion with
 * any other connector defers.
 */
export const TOOL_BUDGET_TOKENS = 35_000;

/**
 * The most tokens of history a reply sends. Above this, capHistory drops
 * the oldest turns. A model with a small context gets less
 * (historyBudgetTokens).
 */
export const HISTORY_BUDGET_TOKENS = 60_000;

/**
 * The share of a model's context the history can take. The rest is for
 * the tools, the instructions and the reply.
 */
const HISTORY_SHARE_OF_CONTEXT = 0.3;

/**
 * About how many tokens of history a reply on a model with this context
 * sends: HISTORY_SHARE_OF_CONTEXT of it, at most HISTORY_BUDGET_TOKENS, so
 * a long thread on a large context doesn't send far more each reply.
 */
export function historyBudgetTokens(contextTokens: number): number {
  return Math.min(
    HISTORY_BUDGET_TOKENS,
    Math.floor(contextTokens * HISTORY_SHARE_OF_CONTEXT),
  );
}

/**
 * The most mentioned connectors whose tools a reply that searches tools
 * loads. Other mentioned connectors are deferred like the rest.
 */
const MAX_LOADED_MENTIONS = 3;

/**
 * Anthropic's search tool's key in the tool set. Saved search parts use
 * it.
 */
export const TOOL_SEARCH_KEY = "toolSearch";

/**
 * a8's own search tool's key (ADR 0016). It differs from TOOL_SEARCH_KEY,
 * so a Claude reply doesn't read a8's search calls in its history as
 * Anthropic's.
 */
export const FIND_TOOLS_KEY = "findTools";

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
 * How a reply that defers connector tools lets the model find them:
 * - `anthropic`: Anthropic's tool search, on Claude (ADR 0006). The
 *   deferred tools go in the request with `deferLoading`.
 * - `a8`: a8's own findTools, on every other model (ADR 0016). `create`
 *   builds it over the deferred tools. They stay out of the request until
 *   a search finds them (`activeTools`).
 */
export type ToolSearch =
  | { kind: "anthropic"; tool: Tool }
  | { kind: "a8"; create: (deferredTools: ToolSet) => Tool };

/**
 * The reply's tools. With `deferred` false, every connector tool loads,
 * the mentioned connectors' first. With `deferred` true, the first
 * MAX_LOADED_MENTIONS mentioned connectors and the `found` tools load, and
 * every other connector tool is deferred, its description starting with
 * the connector's name in brackets, so search can match terse names. When
 * no connector tool is left over, loading is `all`. Native tools always
 * load.
 *
 * `loaded` is set for a8's search only. It names the tools the model sees
 * from the first step: the loaded ones and findTools. The deferred tools
 * are in `tools` too, so a call to one that a search finds can run.
 *
 * @param found The tools a8's search found in the thread before
 *   (threadFoundTools). They load on Claude too, since its history can
 *   call them without a tool search reference.
 */
export function arrangeReplyTools({
  nativeTools,
  groups,
  mentioned,
  deferred,
  found,
  search,
}: {
  nativeTools: ToolSet;
  groups: ConnectorToolGroup[];
  mentioned: ConnectorView[];
  deferred: boolean;
  found: ReadonlySet<string>;
  search: ToolSearch;
}): { tools: ToolSet; loading: ToolLoading; loaded?: string[] } {
  const isMentioned = (group: ConnectorToolGroup) =>
    mentioned.some(({ id }) => id === group.connector.id);
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
  const loadedGroups = mentionedGroups.slice(0, MAX_LOADED_MENTIONS);
  const leftOver = groups
    .filter((group) => !loadedGroups.includes(group))
    .flatMap((group) =>
      Object.entries(group.tools).map(
        ([name, tool]) => [name, tool, group.connector] as const,
      ),
    );
  const tools: ToolSet = {
    ...toolsOf(loadedGroups),
    ...nativeTools,
    ...Object.fromEntries(
      leftOver
        .filter(([name]) => found.has(name))
        .map(([name, tool]) => [name, tool]),
    ),
  };
  const deferredTools: ToolSet = Object.fromEntries(
    leftOver
      .filter(([name]) => !found.has(name))
      .map(([name, tool, connector]) => [name, describeDeferred(connector, tool)]),
  );
  if (Object.keys(deferredTools).length === 0) {
    return { tools, loading: "all" };
  }
  if (search.kind === "anthropic") {
    return {
      tools: {
        ...tools,
        [TOOL_SEARCH_KEY]: search.tool,
        ...Object.fromEntries(
          Object.entries(deferredTools).map(([name, tool]) => [
            name,
            withDeferLoading(tool),
          ]),
        ),
      },
      loading: "search",
    };
  }
  return {
    tools: {
      ...tools,
      [FIND_TOOLS_KEY]: search.create(deferredTools),
      ...deferredTools,
    },
    loading: "search",
    loaded: [...Object.keys(tools), FIND_TOOLS_KEY],
  };
}

/** The deferred tool, its description starting with its connector's name. */
function describeDeferred(connector: Connector, tool: Tool): Tool {
  // Spreading loses which kind of Tool this is, so TypeScript needs the cast.
  return {
    ...tool,
    description: `[${connector.name}] ${tool.description ?? ""}`.trimEnd(),
  } as Tool;
}

/**
 * The tool, sent with Anthropic's `deferLoading`. Not the AI SDK's own
 * `deferLoading`, which is for its toolSearch().
 */
function withDeferLoading(tool: Tool): Tool {
  return {
    ...tool,
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
  const searchCallIds = findSearchCallIds(messages);
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

/**
 * The ids of the history's Anthropic tool search calls, the tool-calls
 * marked `providerExecuted`. a8's only provider tool is Anthropic's search.
 */
function findSearchCallIds(messages: ModelMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant" || typeof message.content === "string") {
      continue;
    }
    for (const part of message.content) {
      if (part.type === "tool-call" && part.providerExecuted) {
        ids.add(part.toolCallId);
      }
    }
  }
  return ids;
}

/**
 * The messages without Anthropic's tool search calls and their results,
 * which hold the tool references. Only Claude reads them, so a reply on
 * another model drops them (ADR 0016). The calls to the tools a search
 * found stay. A message left with no content goes too. Messages with
 * nothing to drop come back as they are.
 *
 * A search call is a tool-call marked `providerExecuted`, as in
 * dropGoneToolReferences. No other model can run a tool Anthropic ran, so
 * this would drop any other Anthropic provider tool's parts too.
 */
export function dropAnthropicToolSearch(
  messages: ModelMessage[],
): ModelMessage[] {
  const searchCallIds = findSearchCallIds(messages);
  if (searchCallIds.size === 0) return messages;

  return messages.flatMap((message) => {
    if (message.role !== "assistant" && message.role !== "tool") {
      return [message];
    }
    if (typeof message.content === "string") return [message];
    const content = message.content.filter(
      (part) =>
        !(
          (part.type === "tool-call" || part.type === "tool-result") &&
          searchCallIds.has(part.toolCallId)
        ),
    );
    if (content.length === message.content.length) return [message];
    return content.length === 0
      ? []
      : [{ ...message, content } as ModelMessage];
  });
}

/**
 * The history without its oldest turns, once it passes `budgetTokens`. A
 * turn starts at a user message, and the messages before the first user
 * message count with the first turn. Whole turns go, so no tool result
 * loses its tool call. The newest turn stays however large it is. Tokens
 * are counted as in estimateToolTokens.
 *
 * The cut moves in steps of half the budget, not a turn at a time. Each
 * reply then sends the same oldest turns as the last one until the history
 * grows by half the budget, so the prompt cache keeps working. What's left
 * is between about half the budget and the budget.
 */
export function capHistory(
  messages: ModelMessage[],
  budgetTokens: number = HISTORY_BUDGET_TOKENS,
): ModelMessage[] {
  const tokens = messages.map((message) =>
    Math.ceil(JSON.stringify(message).length / 4),
  );
  const total = tokens.reduce((sum, count) => sum + count, 0);
  if (total <= budgetTokens) return messages;

  // The tokens to drop, rounded up to a step. It stays the same while the
  // history grows by less than a step, and so does the cut.
  const step = budgetTokens / 2;
  const toDrop = Math.ceil((total - budgetTokens) / step) * step;
  let dropped = 0;
  let newestTurn = 0;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user" && i > 0) {
      if (dropped >= toDrop) return messages.slice(i);
      newestTurn = i;
    }
    dropped += tokens[i];
  }
  return newestTurn === 0 ? messages : messages.slice(newestTurn);
}

function isGoneReference(
  reference: unknown,
  offered: ReadonlySet<string>,
): boolean {
  const name = referencedToolName(reference);
  return name !== undefined && !offered.has(name);
}

function isSearchTool(toolName: string): boolean {
  return toolName === TOOL_SEARCH_KEY || toolName === FIND_TOOLS_KEY;
}

/**
 * The tools a search result names: Anthropic's tool references, or the
 * `tools` of a8's findTools result.
 */
function foundToolNames(output: unknown): string[] {
  if (Array.isArray(output)) {
    return output.flatMap((reference: unknown) => {
      const name = referencedToolName(reference);
      return name === undefined ? [] : [name];
    });
  }
  const tools = (output as { tools?: unknown } | null)?.tools;
  return Array.isArray(tools)
    ? tools.filter((name): name is string => typeof name === "string")
    : [];
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

  /**
   * @param connections How many connections the user has, of any status.
   *   With none, the reply's instructions have no connector text.
   */
  constructor(
    private readonly threadId: string,
    private readonly connections: number,
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
        if (isSearchTool(part.toolName)) {
          queries.set(part.toolCallId, (part.input as { query?: unknown }).query);
        } else {
          this.called.push(part.toolName);
        }
      } else if (part.type === "tool-result" && isSearchTool(part.toolName)) {
        this.searches.push({
          query: queries.get(part.toolCallId),
          found: foundToolNames(part.output),
        });
      }
    }
    // @ai-sdk/anthropic reports pause_turn as "stop", which ends the reply.
    if (step.rawFinishReason === "pause_turn")
      this.pausedSteps.push(this.steps);
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
      connections: this.connections,
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
