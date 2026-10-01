import {
  listStreams,
  listUIMessages,
  syncStreams,
  vStreamArgs,
  type StreamArgs,
} from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components } from "./_generated/api";
import {
  internalAction,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireOwnedThread, requireViewer } from "./lib/access";
import { chatAgent } from "./lib/agent";
import { chatModel, resolveModelId } from "./lib/models";
import { replyOptions } from "./lib/reply";
import { send } from "./lib/send";

// The browser's time zone. The Send checks it (convex/lib/send.ts).
const vTimeZone = v.optional(v.string());

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

/** A page of a thread's messages, plus the deltas of replies still streaming. */
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
    const streams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs: await threadStreamArgs(ctx, args.threadId, args.streamArgs),
    });
    return { ...paginated, streams };
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

/**
 * Streams the reply to a saved prompt, writing deltas to the thread as they
 * arrive. A model or provider error marks the pending reply as failed.
 * Scheduled only by a Send (convex/lib/send.ts).
 */
export const streamReply = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
    userId: v.string(),
    timeZone: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const result = await chatAgent.streamText(
      ctx,
      { threadId: args.threadId, userId: args.userId },
      {
        promptMessageId: args.promptMessageId,
        model: chatModel(resolveModelId()),
        ...replyOptions({ timeZone: args.timeZone, now: new Date() }),
      },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );
    await result.consumeStream();
    return null;
  },
});
