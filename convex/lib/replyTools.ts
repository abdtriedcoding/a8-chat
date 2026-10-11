// Everything a reply needs for its tools, from one call: the tools, which
// actions wait on a card, the step cap, the connector instructions, a log,
// and a close. streamReply calls createReplyTools before the model
// and close once the reply ends. connectorTools.ts builds the tools and
// calls the vendors, and toolLoading.ts decides how they load.

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
import { createConnectorTools, type ConnectorTools } from "./connectorTools";
import { findMentions } from "./connectorView";
import { connectorInstructions } from "./instructions";
import {
  arrangeReplyTools,
  dropGoneToolReferences,
  ReplyToolLog,
  TOOL_BUDGET_TOKENS,
} from "./toolLoading";

export type ReplyTools = {
  /** The native tools and the connector tools, arranged by toolLoading.ts. */
  tools: ToolSet;
  /**
   * The reply's `toolApproval` option. Every connector action waits for the
   * user to approve it (ADR 0002, ADR 0008). Reads run at once.
   */
  toolApproval: Record<string, ToolApprovalStatus>;
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
 * @param stepsTaken The steps the reply took before it paused on action
 *   cards. 0 for a new reply.
 */
export async function createReplyTools(
  ctx: ActionCtx,
  {
    threadId,
    promptText,
    connections,
    threadDefersTools,
    stepsTaken,
  }: {
    threadId: string;
    promptText: string;
    connections: Doc<"connections">[];
    threadDefersTools: boolean;
    stepsTaken: number;
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
    connectorText: connectorInstructions({ connections, mentioned, loading }),
    maxSteps: Math.max(
      1,
      (connectorTools.groups.length > 0
        ? MAX_REPLY_STEPS
        : MAX_STEPS_WITHOUT_CONNECTORS) - stepsTaken,
    ),
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
  await ctx.runMutation(internal.chat.reply.deferThreadTools, { threadId });
  return true;
}
