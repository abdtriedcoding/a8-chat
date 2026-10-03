// See the docs at https://docs.convex.dev/agents/streaming
import {
  abortStream,
  createThread,
  listMessages,
  listStreams,
  syncStreams,
  toUIMessages,
  vStreamArgs,
  type Message,
  type StreamArgs,
  type SyncStreamsReturnValue,
} from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { chatAgent, MAX_REPLY_STEPS } from "./agents/chat";
import { requireUser } from "./auth";
import { replyInstructions } from "./lib/instructions";
import { checkPrompt, titleFromPrompt } from "./lib/prompt";
import { resolveTimeZone } from "./lib/timeZone";
import { authorizeThreadAccess, getOwnThread } from "./threads";

// The browser's time zone, unchecked. Each Send checks it (resolveTimeZone).
const vTimeZone = v.optional(v.string());

/**
 * The reason we give when the user presses Stop. It's passed to abortStream,
 * and saved as the error on a stopped reply that we hide.
 */
const STOPPED = "Stopped by the user";

/**
 * Extra data listThreadMessages adds to messages. If the user stopped a
 * turn's reply, every message in that turn gets `stopped`. `keepText` says
 * whether the reply's text should still be shown. Other messages get none.
 */
export type MessageMetadata = { stopped: { keepText: boolean } };

export const startThread = mutation({
  args: { prompt: v.string(), timeZone: vTimeZone },
  handler: async (ctx, { prompt, timeZone }) => {
    const user = await requireUser(ctx);
    const text = checkPrompt(prompt);
    const threadId = await createThread(ctx, components.agent, {
      userId: user._id,
      title: titleFromPrompt(text),
    });
    await sendPrompt(ctx, { threadId, prompt: text, timeZone });
    return { threadId };
  },
});

export const sendMessage = mutation({
  args: { prompt: v.string(), threadId: v.string(), timeZone: vTimeZone },
  handler: async (ctx, { prompt, threadId, timeZone }) => {
    await authorizeThreadAccess(ctx, threadId);
    await sendPrompt(ctx, { threadId, prompt: checkPrompt(prompt), timeZone });
  },
});

/**
 * Replaces the thread's last reply with a new reply to the same prompt. The
 * Regenerate button calls this.
 */
export const regenerateReply = mutation({
  args: { threadId: v.string(), timeZone: vTimeZone },
  returns: v.null(),
  handler: async (ctx, { threadId, timeZone }) => {
    await authorizeThreadAccess(ctx, threadId);
    await redoLastTurn(ctx, { threadId, timeZone });
    return null;
  },
});

/**
 * Replaces the text of the thread's last prompt, and its reply with a new
 * one. Saving the prompt editor calls this. It always edits the last
 * prompt, so older prompts can't be edited.
 */
export const editPrompt = mutation({
  args: { threadId: v.string(), prompt: v.string(), timeZone: vTimeZone },
  returns: v.null(),
  handler: async (ctx, { threadId, prompt, timeZone }) => {
    await authorizeThreadAccess(ctx, threadId);
    const text = checkPrompt(prompt);
    await redoLastTurn(ctx, { threadId, timeZone, text });
    return null;
  },
});

/**
 * Deletes the thread's last turn, the prompt and its reply, and then sends
 * the prompt again for a new reply. With `text`, the new prompt has that
 * text in place of the old one. regenerateReply and editPrompt call this.
 *
 * The new prompt gets the same order back, and a new id. Asking the model
 * again with the old prompt's id wouldn't start over. The Agent would
 * continue the old reply instead.
 *
 * Deleting the prompt also ends any runner left over from the old turn.
 * streamReply checks for its prompt before it calls the model, and the Agent
 * doesn't save a reply to a prompt that's gone. So this works right after a
 * Stop, and on a turn whose runner never replied.
 *
 * Throws while the reply is still on its way. That includes a stopped reply
 * that its runner hasn't saved yet, which takes a moment.
 */
async function redoLastTurn(
  ctx: MutationCtx,
  {
    threadId,
    timeZone,
    text,
  }: { threadId: string; timeZone: string | undefined; text?: string },
) {
  // Newest first, with every status. A reply ends after MAX_REPLY_STEPS
  // steps, and each step saves at most two messages. Those are the model's
  // message and, if it called tools, their results. So the prompt and its
  // whole reply fit on this page.
  const { page } = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { numItems: 2 * MAX_REPLY_STEPS + 1, cursor: null },
  });
  const order = page[0]?.order;
  const turn = page.filter((message) => message.order === order);
  const prompt = turn.find((message) => message.message?.role === "user");
  if (order === undefined || prompt?.message?.role !== "user") {
    throw new ConvexError({
      code: "NO_PROMPT",
      message: "There's no prompt in this chat.",
    });
  }
  // A pending message means the runner is still writing the reply. A turn
  // with only its prompt is fine. Its runner hasn't started yet, or it
  // stopped before saving anything. Without the prompt, it won't call the
  // model.
  if (turn.some((message) => message.status === "pending")) {
    throw new ConvexError({
      code: "REPLY_IN_PROGRESS",
      message: "Wait for the reply to finish first.",
    });
  }

  // The Agent also aborts any stream still running at this order.
  await chatAgent.deleteMessages(ctx, {
    messageIds: turn.map((message) => message._id),
  });
  // The Agent keeps finished and aborted streams for 5 minutes. This
  // deletes the turn's streams now, for two reasons. listThreadMessages
  // sends aborted streams to the client, and the client shows one in place
  // of a pending reply at the same order and step. So the old text would
  // show over the new reply. And when the user stops a reply, the Agent
  // builds the saved reply from every stream at its order. The old text
  // would end up in the new reply.
  const streams = await listStreams(ctx, components.agent, {
    threadId,
    startOrder: order,
    includeStatuses: ["streaming", "finished", "aborted"],
  });
  for (const { streamId } of streams.filter((s) => s.order === order)) {
    await ctx.runMutation(components.agent.streams.deleteStreamSync, {
      streamId,
    });
  }
  // The new reply gets the same order, so an old stop would stop it too.
  const stopped = await getStoppedReply(ctx, threadId, order);
  if (stopped) await ctx.db.delete("stoppedReplies", stopped._id);

  // This sends the saved message rather than its text, so nothing else in
  // the prompt is lost.
  const message =
    text === undefined ? prompt.message : withText(prompt.message, text);
  await sendPrompt(ctx, { threadId, message, timeZone });
}

type UserMessage = Extract<Message, { role: "user" }>;

/**
 * The prompt with its text replaced by `text`. Image and file parts stay,
 * and the new text goes after them.
 */
function withText(message: UserMessage, text: string): UserMessage {
  if (typeof message.content === "string") return { ...message, content: text };
  const attachments = message.content.filter((part) => part.type !== "text");
  return { ...message, content: [...attachments, { type: "text", text }] };
}

/**
 * Saves a prompt and schedules the reply to it (streamReply). startThread,
 * sendMessage and redoLastTurn all send through here.
 *
 * Pass `prompt` for text the user just wrote, or `message` to send a saved
 * prompt again.
 */
async function sendPrompt(
  ctx: MutationCtx,
  {
    threadId,
    timeZone,
    ...content
  }: { threadId: string; timeZone: string | undefined } & (
    { prompt: string } | { message: Message }
  ),
) {
  const { messageId, message } = await chatAgent.saveMessage(ctx, {
    threadId,
    ...content,
    // we're in a mutation, so skip embeddings for now. They'll be generated
    // lazily when streaming text.
    skipEmbeddings: true,
  });
  await ctx.scheduler.runAfter(0, internal.chat.streamReply, {
    threadId,
    promptMessageId: messageId,
    order: message.order,
    timeZone: resolveTimeZone(timeZone),
  });
}

/**
 * Stops the reply the thread is waiting for. The Stop button calls this.
 *
 * It saves a stoppedReplies row, then aborts the reply's stream. The runner
 * (streamReply) sees the abort the next time it saves text, and cancels the
 * model call. If the stream doesn't exist yet, the row still stops the
 * reply, because the runner checks for it before calling the model.
 *
 * It doesn't change the reply message. The runner is still saving text
 * every 100 ms, so changing the message here would clash with it. The runner
 * cleans up the reply itself when it finishes (settleStop).
 *
 * Does nothing if the reply has already finished.
 *
 * Pass `keepText: false` when the user hadn't seen any of the reply yet. The
 * reply is then hidden, even if some of its text had reached the server.
 */
export const stopReply = mutation({
  args: { threadId: v.string(), keepText: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { threadId, keepText }) => {
    await authorizeThreadAccess(ctx, threadId);

    const {
      page: [latest],
    } = await listMessages(ctx, components.agent, {
      threadId,
      paginationOpts: { numItems: 1, cursor: null },
    });
    // The reply is still coming if the newest message is the user's prompt
    // (the runner hasn't saved anything yet) or a pending reply.
    const inProgress =
      latest?.status === "pending" || latest?.message?.role === "user";
    if (!latest || !inProgress) return null;

    const { order } = latest;
    if (!(await getStoppedReply(ctx, threadId, order))) {
      await ctx.db.insert("stoppedReplies", { threadId, order, keepText });
    }
    await abortStream(ctx, components.agent, {
      threadId,
      order,
      reason: STOPPED,
    });
    return null;
  },
});

/**
 * Gets the model's reply to a prompt and streams its text into the thread
 * as it arrives. sendPrompt schedules it.
 */
export const streamReply = internalAction({
  args: {
    promptMessageId: v.string(),
    threadId: v.string(),
    // The prompt's order. The reply gets the same one.
    order: v.number(),
    timeZone: v.string(),
  },
  handler: async (ctx, { promptMessageId, threadId, order, timeZone }) => {
    try {
      // Skip the model call if the user pressed Stop first, or a regenerate
      // or an edit replaced this turn.
      const canReply = await ctx.runQuery(internal.chat.canReply, {
        threadId,
        promptMessageId,
        order,
      });
      if (!canReply) return;
      const result = await chatAgent.streamText(
        ctx,
        { threadId },
        {
          promptMessageId,
          instructions: replyInstructions(timeZone, new Date()),
        },
        // more custom delta options (`true` uses defaults)
        { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
      );
      // We need to make sure the stream finishes - by awaiting each chunk
      // or using this call to consume it all.
      await result.consumeStream();
    } finally {
      // Runs even if the model call failed. Does nothing unless the user
      // stopped this reply.
      await ctx.runMutation(internal.chat.settleStop, {
        threadId,
        promptMessageId,
        order,
      });
    }
  },
});

/**
 * Whether streamReply should call the model. It's false if the user pressed
 * Stop before the runner started. It's also false if the prompt is gone. A
 * regenerate or an edit deletes the old prompt, so a runner left over from
 * before it stops here.
 */
export const canReply = internalQuery({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
    order: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, { threadId, promptMessageId, order }) => {
    if (!(await promptExists(ctx, promptMessageId))) return false;
    return (await getStoppedReply(ctx, threadId, order)) === null;
  },
});

/**
 * Cleans up a stopped reply after the runner is done with it. streamReply
 * calls it last. Does nothing if the user didn't stop the reply, or if a
 * regenerate or an edit replaced the turn.
 *
 * When a stream is aborted, the Agent saves the partial reply as failed.
 * The model never sees failed messages, so this sets the status by hand:
 * - With `keepText`, a failed reply that has text becomes a success. The
 *   model then sees it, and "continue" works. A reply with no text stays
 *   failed, so the model doesn't get an empty message.
 * - Without `keepText`, a reply that finished anyway becomes failed. It stays
 *   hidden, and the model doesn't see it.
 *
 * A reply that's still pending is left for the Agent to finish.
 */
export const settleStop = internalMutation({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
    order: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { threadId, promptMessageId, order }) => {
    const stopped = await getStoppedReply(ctx, threadId, order);
    if (!stopped) return null;
    // After a regenerate or an edit deletes this prompt, the same order
    // belongs to a new turn, and that turn can have its own stop. Without
    // this prompt, the list below has no upper bound. It would read the new
    // turn's messages and change the new reply.
    if (!(await promptExists(ctx, promptMessageId))) return null;

    // This turn's messages, newest first. The list starts at this turn, so
    // messages the user sent afterwards don't push it off the page. The page
    // size fits the prompt plus everything one reply can save.
    const { page } = await ctx.runQuery(
      components.agent.messages.listMessagesByThreadId,
      {
        threadId,
        upToAndIncludingMessageId: promptMessageId,
        order: "desc",
        paginationOpts: { numItems: 2 * MAX_REPLY_STEPS + 1, cursor: null },
      },
    );
    for (const message of page) {
      if (message.order !== order || message.message?.role === "user") continue;
      if (stopped.keepText) {
        if (message.status === "failed" && message.text?.trim()) {
          // The Agent's "async abort" error stays on the message, because a
          // patch can't remove a field.
          await ctx.runMutation(components.agent.messages.updateMessage, {
            messageId: message._id,
            patch: { status: "success" },
          });
        }
      } else if (message.status === "success") {
        await ctx.runMutation(components.agent.messages.updateMessage, {
          messageId: message._id,
          patch: { status: "failed", error: STOPPED },
        });
      }
    }
    return null;
  },
});

/** The turn's stoppedReplies row, or null if the user didn't stop it. */
async function getStoppedReply(ctx: QueryCtx, threadId: string, order: number) {
  return await ctx.db
    .query("stoppedReplies")
    .withIndex("by_threadId_and_order", (q) =>
      q.eq("threadId", threadId).eq("order", order),
    )
    .unique();
}

/** False once a regenerate or an edit has deleted the prompt. */
async function promptExists(ctx: QueryCtx, promptMessageId: string) {
  const [prompt] = await ctx.runQuery(
    components.agent.messages.getMessagesByIds,
    { messageIds: [promptMessageId] },
  );
  return Boolean(prompt);
}

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

    const paginated = await listMessages(ctx, components.agent, args);

    // Finds the stopped turns on this page with one index scan, and adds
    // `stopped` to each of their messages (MessageMetadata). The client
    // reads it from the prompt, because a reply that's still streaming
    // doesn't come from this list. A turn has at most one row.
    const stopped = new Map<number, MessageMetadata>();
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
        stopped.set(row.order, { stopped: { keepText: row.keepText } });
      }
    }

    return {
      ...paginated,
      page: toUIMessages<MessageMetadata>(
        paginated.page.map((message) => ({
          ...message,
          metadata: stopped.get(message.order),
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
