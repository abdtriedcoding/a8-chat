// Everything a reply needs from connectors, from one call: its tools, which
// actions wait on a card, how the tools load, the connector instructions,
// a log, and a close. streamReply calls createReplyTools before the model
// and close once the reply ends. connectorTools.ts builds the tools and
// calls the vendors, and toolLoading.ts decides how they load.

import type { ModelMessage, Tool, ToolApprovalStatus, ToolSet } from "ai";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { createConnectorTools, type ConnectorTools } from "./connectorTools";
import { findMentions } from "./connectorView";
import { connectorInstructions } from "./instructions";
import {
  arrangeReplyTools,
  dropGoneToolReferences,
  ReplyToolLog,
  TOOL_BUDGET_TOKENS,
  type ToolLoading,
} from "./toolLoading";

export type ReplyTools = {
  /** The native tools and the connector tools, arranged by `loading`. */
  tools: ToolSet;
  /**
   * The reply's `toolApproval` option. Every connector action waits for the
   * user to approve it (ADR 0002, ADR 0008). Reads run at once.
   */
  toolApproval: Record<string, ToolApprovalStatus>;
  /** How the reply offers connector tools. */
  loading: ToolLoading;
  /**
   * The connector part of the instructions, for replyInstructions.
   * Undefined for a user with no connections.
   */
  connectorText: string | undefined;
  /** Whether the reply offers any connector tools. */
  hasConnectorTools: boolean;
  /**
   * The history with each tool search result cut down to the tools this
   * reply offers (dropGoneToolReferences). For the Agent's contextHandler.
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
 * @param nativeTools The tools a8 offers on every reply.
 * @param toolSearch The tool that finds deferred connector tools.
 */
export async function createReplyTools(
  ctx: ActionCtx,
  {
    threadId,
    promptText,
    connections,
    threadDefersTools,
    nativeTools,
    toolSearch,
  }: {
    threadId: string;
    promptText: string;
    connections: Doc<"connections">[];
    threadDefersTools: boolean;
    nativeTools: ToolSet;
    toolSearch: Tool;
  },
): Promise<ReplyTools> {
  const mentioned = findMentions(promptText);
  const connectorTools = await createConnectorTools(ctx, connections);
  const deferred = await defersTools(ctx, {
    threadId,
    threadDefers: threadDefersTools,
    connectorTools,
  });
  const { tools, loading } = arrangeReplyTools({
    nativeTools,
    groups: connectorTools.groups,
    mentioned,
    deferred,
    toolSearch,
  });
  const offered = new Set(Object.keys(tools));
  const log = new ReplyToolLog(
    threadId,
    connections.length,
    deferred,
    loading,
    connectorTools.groups,
  );
  return {
    tools,
    toolApproval: connectorTools.toolApproval,
    loading,
    connectorText: connectorInstructions({ connections, mentioned, loading }),
    hasConnectorTools: connectorTools.groups.length > 0,
    fitHistory: (messages) => dropGoneToolReferences(messages, offered),
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
  await ctx.runMutation(internal.chat.deferThreadTools, { threadId });
  return true;
}
