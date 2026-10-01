import {
  listStreams,
  listUIMessages,
  syncStreams,
  vStreamArgs,
  type StreamArgs,
} from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireOwnedThread, requireViewer } from "./lib/access";
import { chatAgent } from "./lib/agent";
import { chatModel, resolveModelId } from "./lib/models";
import { replyOptions } from "./lib/reply";
import { send } from "./lib/send";
import {
  isTurnStopped,
  saveStoppedReply,
  STOPPED,
  stop,
  stoppedTurns,
} from "./lib/stop";

// The browser's time zone. The Send checks it (convex/lib/send.ts).
const vTimeZone = v.optional(v.string());

// A turn: a prompt and its reply share the Agent's `order`.
const vTurn = { threadId: v.string(), order: v.number() };

/** Creates a thread from its first prompt and starts the reply. */
export const startThread = mutation({
  args: { prompt: v.string(), timeZone: vTimeZone },
  returns: v.object({ threadId: v.string() }),
  handler: async (ctx, args) => {
    return await send(ctx, { kind: "startThread", ...args });
  },
});

/** Adds a prompt to an existing thread and starts the reply. */
export const sendMessage = mutation({
  args: { threadId: v.string(), prompt: v.string(), timeZone: vTimeZone },
  returns: v.null(),
  handler: async (ctx, args) => {
    await send(ctx, { kind: "sendPrompt", ...args });
    return null;
  },
});

/**
 * Stops the thread's reply in progress. Its text so far stays, unless the
 * user hadn't seen any (`keepText: false`, convex/lib/stop.ts).
 */
export const stopReply = mutation({
  args: { threadId: v.string(), keepText: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    await requireOwnedThread(ctx, args.threadId, viewer._id);
    await stop(ctx, args.threadId, args.keepText);
    return null;
  },
});

/**
 * A page of a thread's messages, plus the deltas of replies still streaming.
 * `stopped` is on every message of a turn whose reply the user stopped,
 * with whether its text was kept, and null elsewhere. A reply rebuilt from
 * its stream doesn't have it, but its prompt does.
 */
export const listThreadMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    await requireOwnedThread(ctx, args.threadId, viewer._id);

    const paginated = await listUIMessages(ctx, components.agent, args);
    const stopped = await stoppedTurns(
      ctx,
      args.threadId,
      paginated.page.map((message) => message.order),
    );
    const streams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs: await threadStreamArgs(ctx, args.threadId, args.streamArgs),
      // Aborted ones too, so a stopped reply's text stays on screen until
      // the Agent saves it. A saved reply shows instead of its stream.
      includeStatuses: ["streaming", "aborted"],
    });
    return {
      ...paginated,
      page: paginated.page.map((message) => ({
        ...message,
        stopped: stopped.get(message.order) ?? null,
      })),
      streams,
    };
  },
});

/**
 * Drops delta cursors for streams outside the thread. The Agent reads deltas
 * by stream ID alone, so the thread check doesn't cover them. Cursors are
 * dropped rather than rejected: a finished stream is deleted after 5 minutes,
 * so the client can briefly hold a cursor for one of its own that's gone.
 */
async function threadStreamArgs(
  ctx: QueryCtx,
  threadId: string,
  streamArgs: StreamArgs,
): Promise<StreamArgs> {
  if (streamArgs?.kind !== "deltas") return streamArgs;
  const streams = await listStreams(ctx, components.agent, {
    threadId,
    includeStatuses: ["streaming", "finished", "aborted"],
  });
  const ids = new Set(streams.map((s) => s.streamId));
  return {
    ...streamArgs,
    cursors: streamArgs.cursors.filter((c) => ids.has(c.streamId)),
  };
}

/** Whether the user stopped the turn's reply (convex/lib/stop.ts). */
export const isStopped = internalQuery({
  args: vTurn,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await isTurnStopped(ctx, args.threadId, args.order);
  },
});

/** Saves a stopped reply's text as a normal reply (convex/lib/stop.ts). */
export const saveStopped = internalMutation({
  args: vTurn,
  returns: v.null(),
  handler: async (ctx, args) => {
    await saveStoppedReply(ctx, args.threadId, args.order);
    return null;
  },
});

/**
 * Streams the reply to a saved prompt, writing deltas to the thread as they
 * arrive. A model or provider error marks the pending reply as failed.
 * Scheduled only by a Send (convex/lib/send.ts).
 */
export const streamReply = internalAction({
  args: {
    ...vTurn,
    promptMessageId: v.string(),
    userId: v.string(),
    timeZone: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const turn = { threadId: args.threadId, order: args.order };
    const isStopped = (): Promise<boolean> =>
      ctx.runQuery(internal.chat.isStopped, turn);
    // A stop pressed before the reply started means no model call at all.
    if (await isStopped()) return null;

    // A stop that lands before the reply's stream exists has no stream to
    // abort, so look once more when the model starts answering. The stream
    // is created on "start", well before the model's first chunk comes back.
    const abort = new AbortController();
    let checked = false;
    try {
      const result = await chatAgent.streamText(
        ctx,
        { threadId: args.threadId, userId: args.userId },
        {
          promptMessageId: args.promptMessageId,
          model: chatModel(resolveModelId()),
          ...replyOptions({ timeZone: args.timeZone, now: new Date() }),
          abortSignal: abort.signal,
          onChunk: async ({ chunk }) => {
            if (checked || chunk.type === "start") return;
            checked = true;
            if (await isStopped()) abort.abort(STOPPED);
          },
        },
        { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
      );
      await result.consumeStream();
    } finally {
      // Does nothing unless the reply was stopped.
      await ctx.runMutation(internal.chat.saveStopped, turn);
    }
    return null;
  },
});
