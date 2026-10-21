// Everything a reply needs for its tools, from one call: the tools, which
// actions wait on a card or run at once, the step cap, the connector
// instructions, a log, and a close. streamReply calls createReplyTools
// before the model and close once the reply ends. connectorTools.ts builds
// the tools and calls the vendors, and toolLoading.ts decides how they load.

import type { ModelMessage, ToolApprovalStatus, ToolSet } from "ai";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  MAX_REPLY_STEPS,
  MAX_STEPS_WITHOUT_CONNECTORS,
  nativeTools,
  toolSearch,
} from "../agents/chat";
import { createFindTools } from "../tools/findTools";
import { createScheduledPromptTools } from "../tools/scheduledPrompts";
import {
  autoApproveActions,
  MAX_AUTO_APPROVED_ACTIONS,
  type AutoApproval,
} from "./autoApprove";
import { createConnectorTools, type ConnectorTools } from "./connectorTools";
import { findMentions } from "./connectorView";
import { connectorInstructions } from "./instructions";
import { isClaude, type Model } from "./models";
import {
  arrangeReplyTools,
  capHistory,
  dropAnthropicToolSearch,
  dropGoneToolReferences,
  FIND_TOOLS_KEY,
  historyBudgetTokens,
  ReplyToolLog,
  TOOL_BUDGET_TOKENS,
  TOOL_SEARCH_KEY,
  type ToolSearch,
} from "./toolLoading";

/**
 * Anthropic's prompt cache breakpoint, for `providerOptions`. A request
 * reads the cache up to the last breakpoint, so later steps and the next
 * prompt don't pay full price for the history before it. Anthropic caches
 * only prompts over a minimum length, 4096 tokens for Haiku 4.5, and sends
 * shorter ones uncached.
 */
export const CACHE_BREAKPOINT = {
  anthropic: { cacheControl: { type: "ephemeral" } },
} as const;

/**
 * The messages with a cache breakpoint on the one at `index`. A negative
 * `index`, for an empty history, leaves them as they are.
 */
export function withCacheBreakpoint(
  messages: ModelMessage[],
  index: number,
): ModelMessage[] {
  if (index < 0 || index >= messages.length) return messages;
  return messages.map((message, i) =>
    i === index
      ? {
          ...message,
          providerOptions: { ...message.providerOptions, ...CACHE_BREAKPOINT },
        }
      : message,
  );
}

export type ReplyTools = {
  /**
   * The native tools, a8's scheduled prompt tools and the connector tools,
   * arranged by toolLoading.ts.
   */
  tools: ToolSet;
  /**
   * The tools the model sees in its next step, for `prepareStep`. Set when
   * a8's own search defers tools (ADR 0016): the loaded tools, findTools
   * and every tool a search found so far in the reply. It's undefined when
   * the model sees every tool in `tools`.
   */
  activeTools: () => string[] | undefined;
  /**
   * The reply's `toolApproval` option. Every action waits for the user to
   * approve it (ADR 0002, ADR 0008, ADR 0013). With auto-approve on, the
   * reply's first MAX_AUTO_APPROVED_ACTIONS actions run at once instead
   * (ADR 0014), and the AI SDK marks their approval `isAutomatic`. Reads
   * run at once.
   */
  toolApproval: Record<string, ToolApprovalStatus | AutoApproval>;
  /** Whether the reply has the scheduled prompt tools, for replyInstructions. */
  canSchedule: boolean;
  /**
   * Whether the reply auto-approves its actions, for replyInstructions.
   * False when it has no actions, or starts past the cap.
   */
  autoApprove: boolean;
  /**
   * The connector part of the instructions, for replyInstructions.
   * Undefined for a user with no connections.
   */
  connectorText: string | undefined;
  /**
   * The most model calls this part of the reply can make, at least 1. The
   * cap counts steps across the whole reply. The Agent's count starts over
   * when a reply continues after an action card (ADR 0002), so this
   * subtracts stepsTaken. A native tool search adds no step.
   */
  maxSteps: number;
  /**
   * The history fit for the reply's model, for the Agent's contextHandler.
   * On Claude, each tool search result is cut down to the tools this reply
   * offers (dropGoneToolReferences). On other models, Anthropic's tool
   * search parts go (dropAnthropicToolSearch). Then the oldest turns go
   * past the model's history budget (capHistory, historyBudgetTokens).
   */
  fitHistory: (messages: ModelMessage[]) => ModelMessage[];
  /** The reply's log line. Feed it each step and each tool run. */
  log: Pick<ReplyToolLog, "addStep" | "addToolRun">;
  /**
   * Prints the log and closes every MCP client the reply opened. Call it
   * once, when the reply ends.
   */
  close: () => Promise<void>;
};

/**
 * The reply's tools and what goes with them. Building them sends nothing
 * to the vendors, so a reply that fails before close leaves nothing open.
 * A thread that first crosses TOOL_BUDGET_TOKENS here starts deferring
 * connector tools (defersTools).
 *
 * @param promptText The text of the prompt the reply answers, for its
 *   mentions.
 * @param connections The thread owner's connections, of any status.
 * @param threadDefersTools Whether the thread already defers connector
 *   tools.
 * @param temporary Whether the thread is temporary. It gets no scheduled
 *   prompt tools.
 * @param timeZone The reply's time zone, for the scheduled prompt tools.
 * @param stepsTaken The steps the reply took before it paused on action
 *   cards. 0 for a new reply.
 * @param autoApprove Whether the thread has auto-approve on.
 * @param autoApprovedCount The actions the reply ran without a card
 *   before it paused on action cards. 0 for a new reply.
 * @param model The reply's model. Claude finds deferred tools with
 *   Anthropic's tool search, and every other model with a8's own.
 * @param foundToolNames The tools a8's search found in the thread before
 *   (threadFoundTools). Those the reply no longer offers drop out of the
 *   record.
 */
export async function createReplyTools(
  ctx: ActionCtx,
  {
    threadId,
    promptText,
    connections,
    threadDefersTools,
    temporary,
    timeZone,
    stepsTaken,
    autoApprove,
    autoApprovedCount,
    model,
    foundToolNames,
  }: {
    threadId: string;
    promptText: string;
    connections: Doc<"connections">[];
    threadDefersTools: boolean;
    temporary: boolean;
    timeZone: string;
    stepsTaken: number;
    autoApprove: boolean;
    autoApprovedCount: number;
    model: Model;
    foundToolNames: string[];
  },
): Promise<ReplyTools> {
  const claude = isClaude(model);
  const mentioned = findMentions(promptText);
  const connectorTools = await createConnectorTools(ctx, connections);
  const deferred = await defersTools(ctx, {
    threadId,
    threadDefers: threadDefersTools,
    connectorTools,
  });
  const found = await keepOfferedFoundTools(ctx, {
    threadId,
    foundToolNames,
    connectorTools,
  });
  const scheduledPromptTools = temporary
    ? undefined
    : createScheduledPromptTools(timeZone);
  const search: ToolSearch = claude
    ? { kind: "anthropic", tool: toolSearch }
    : {
        kind: "a8",
        create: (deferredTools) =>
          createFindTools(deferredTools, async (names) => {
            for (const name of names) found.add(name);
            await ctx.runMutation(internal.chat.reply.recordFoundTools, {
              threadId,
              toolNames: [...found],
            });
          }),
      };
  const { tools, loading, loaded } = arrangeReplyTools({
    nativeTools: { ...nativeTools, ...scheduledPromptTools?.tools },
    groups: connectorTools.groups,
    mentioned,
    deferred,
    found,
    search,
  });
  const offered = new Set(Object.keys(tools));
  const actionApproval = {
    ...connectorTools.toolApproval,
    ...scheduledPromptTools?.toolApproval,
  };
  const log = new ReplyToolLog(
    threadId,
    connections.length,
    deferred,
    loading,
    connectorTools.groups,
  );
  const historyBudget = historyBudgetTokens(model.contextTokens);
  return {
    tools,
    activeTools: () => loaded && [...new Set([...loaded, ...found])],
    toolApproval: autoApprove
      ? autoApproveActions(actionApproval, autoApprovedCount)
      : actionApproval,
    canSchedule: scheduledPromptTools !== undefined,
    autoApprove:
      autoApprove &&
      Object.keys(actionApproval).length > 0 &&
      autoApprovedCount < MAX_AUTO_APPROVED_ACTIONS,
    connectorText: connectorInstructions({
      connections,
      mentioned,
      loading,
      searchTool: claude ? TOOL_SEARCH_KEY : FIND_TOOLS_KEY,
    }),
    maxSteps: Math.max(
      1,
      (connectorTools.groups.length > 0
        ? MAX_REPLY_STEPS
        : MAX_STEPS_WITHOUT_CONNECTORS) - stepsTaken,
    ),
    fitHistory: (messages) =>
      capHistory(
        claude
          ? dropGoneToolReferences(messages, offered)
          : dropAnthropicToolSearch(messages),
        historyBudget,
      ),
    log,
    close: async () => {
      log.print();
      await connectorTools.close();
    },
  };
}

/**
 * Whether the reply defers connector tools (ADR 0006). The thread starts to
 * once a reply's connector tools pass TOOL_BUDGET_TOKENS, and keeps on after
 * that, so the tool list stays the same and the prompt cache keeps working.
 * Only that first crossing writes. `threadDefers` comes from getReplyStart.
 */
async function defersTools(
  ctx: ActionCtx,
  {
    threadId,
    threadDefers,
    connectorTools,
  }: {
    threadId: string;
    threadDefers: boolean;
    connectorTools: ConnectorTools;
  },
): Promise<boolean> {
  if (connectorTools.groups.length === 0) return false;
  if (threadDefers) return true;
  if (connectorTools.estimatedTokens <= TOOL_BUDGET_TOKENS) return false;
  await ctx.runMutation(internal.chat.reply.deferThreadTools, { threadId });
  return true;
}

/**
 * The tools a8's search found in the thread before that the reply still
 * offers, after a disconnect or an allowlist change. When some are gone,
 * the thread's record drops them. It returns a Set, which the reply's
 * searches add to.
 */
async function keepOfferedFoundTools(
  ctx: ActionCtx,
  {
    threadId,
    foundToolNames,
    connectorTools,
  }: {
    threadId: string;
    foundToolNames: string[];
    connectorTools: ConnectorTools;
  },
): Promise<Set<string>> {
  const offered = new Set(
    connectorTools.groups.flatMap((group) => Object.keys(group.tools)),
  );
  const kept = foundToolNames.filter((name) => offered.has(name));
  if (kept.length < foundToolNames.length) {
    await ctx.runMutation(internal.chat.reply.recordFoundTools, {
      threadId,
      toolNames: kept,
    });
  }
  return new Set(kept);
}
