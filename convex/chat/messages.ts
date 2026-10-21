import {
  listMessages,
  listStreams,
  syncStreams,
  toUIMessages,
  vStreamArgs,
  type MessageDoc,
  type StreamArgs,
  type SyncStreamsReturnValue,
} from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components } from "../_generated/api";
import { query } from "../_generated/server";
import { getOwnThread } from "../lib/guards";
import { replyModelIds } from "../lib/models";
import { replyFailureReason } from "../lib/replyFailure";
import { isAwaitingContinuation } from "./approval";

/**
 * Extra data listThreadMessages adds to every message in a turn. Messages
 * in other turns get none.
 * - `stopped`: the user stopped the turn's reply.
 * - `failureReason`: the reply failed for a reason we know, and this says
 *   what it is, such as attachments too large for the model.
 * - `continuing`: the user has decided on every action card in the reply,
 *   and the runner hasn't picked the reply up again yet.
 * - `modelId`: the model that wrote the reply (lib/models.ts). Unset while
 *   the reply has no saved step, and for a model that left the list.
 */
export type MessageMetadata = {
  stopped?: true;
  failureReason?: string;
  continuing?: boolean;
  modelId?: string;
};

const MAX_MESSAGES_PER_PAGE = 100;

export const listThreadMessages = query({
  args: {
    // These arguments are required:
    threadId: v.string(),
    paginationOpts: paginationOptsValidator, // Used to paginate the messages.
    streamArgs: vStreamArgs, // Used to stream messages.
  },
  handler: async (ctx, args) => {
    const { threadId, streamArgs } = args;
    if (!(await getOwnThread(ctx, threadId))) {
      return {
        page: [],
        isDone: true,
        continueCursor: "",
        streams: noStreams(streamArgs),
      };
    }
    const streams = await syncStreams(ctx, components.agent, {
      threadId,
      streamArgs,
      // Include aborted streams. Without them, a stopped reply's text would
      // disappear for a moment, between the abort and the Agent saving the
      // partial reply. Once the reply is saved, the client shows it instead.
      includeStatuses: ["streaming", "aborted"],
    });
    // Here you could filter out / modify the stream of deltas / filter out
    // deltas.
    // The Agent reads deltas by stream ID alone, so the thread check doesn't
    // cover them: drop any from a stream outside the thread.
    if (streams?.kind === "deltas") {
      const threadStreams = await listStreams(ctx, components.agent, {
        threadId,
        includeStatuses: ["streaming", "finished", "aborted"],
      });
      const ids = new Set(threadStreams.map((s) => s.streamId));
      streams.deltas = streams.deltas.filter((d) => ids.has(d.streamId));
    }

    // The client picks numItems, so cap it. One query reads that many messages.
    const paginated = await listMessages(ctx, components.agent, {
      ...args,
      paginationOpts: {
        ...args.paginationOpts,
        numItems: Math.min(args.paginationOpts.numItems, MAX_MESSAGES_PER_PAGE),
      },
    });

    // Each turn's metadata, by order. It goes on every message in the turn,
    // because the client reads `stopped` from the prompt (a reply that's
    // still streaming doesn't come from this list), and the Agent combines
    // a reply's messages into one, keeping only the first one's metadata.
    const turnMetadata = new Map<number, MessageMetadata>();

    // Finds the stopped turns on this page with one index scan. A turn has
    // at most one row.
    const orders = paginated.page.map((message) => message.order);
    if (orders.length > 0) {
      const first = Math.min(...orders);
      const last = Math.max(...orders);
      const rows = await ctx.db
        .query("stoppedReplies")
        .withIndex("by_threadId_and_order", (q) =>
          q.eq("threadId", threadId).gte("order", first).lte("order", last),
        )
        .take(last - first + 1);
      for (const row of rows) {
        turnMetadata.set(row.order, { stopped: true });
      }
    }
    // The page is newest first, so the newest turn comes first.
    const newestTurn = paginated.page.filter(
      (message) => message.order === paginated.page[0]?.order,
    );
    if (isAwaitingContinuation(newestTurn)) {
      turnMetadata.set(newestTurn[0].order, {
        ...turnMetadata.get(newestTurn[0].order),
        continuing: true,
      });
    }
    for (const [order, modelId] of replyModelIds(paginated.page)) {
      turnMetadata.set(order, { ...turnMetadata.get(order), modelId });
    }
    for (const message of paginated.page) {
      if (message.status !== "failed") continue;
      const failureReason = replyFailureReason(message.error);
      if (failureReason) {
        turnMetadata.set(message.order, {
          ...turnMetadata.get(message.order),
          failureReason,
        });
      }
    }

    return {
      ...paginated,
      page: toUIMessages<MessageMetadata>(
        paginated.page.map((message) => ({
          ...withToolErrors(message),
          metadata: turnMetadata.get(message.order),
        })),
      ),
      streams,

      // ... you can return other metadata here too.
      // note: this function will be called with various permutations of delta
      // and message args, so returning derived data .
    };
  },
});

/**
 * The message with each failed tool call's result flagged as an error. The
 * AI SDK saves a tool's error as an `error-text` result without the
 * `isError` flag toUIMessages reads, so the client would see a result. With
 * the flag, the call's `errorText` is the error, like "Error: <message>".
 */
function withToolErrors(message: MessageDoc): MessageDoc {
  if (message.message?.role !== "tool") return message;
  return {
    ...message,
    message: {
      ...message.message,
      content: message.message.content.map((part) =>
        part.type === "tool-result" && part.output?.type === "error-text"
          ? { ...part, isError: true }
          : part,
      ),
    },
  };
}

/**
 * syncStreams' result with no streams in it. useUIMessages reads
 * `streams.messages` or `streams.deltas`, whichever it asked for, so the
 * kind has to match.
 */
function noStreams(streamArgs: StreamArgs | undefined): SyncStreamsReturnValue {
  if (!streamArgs) return undefined;
  return streamArgs.kind === "list"
    ? { kind: "list", messages: [] }
    : { kind: "deltas", deltas: [] };
}
