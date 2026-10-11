import { createThread, listStreams, type Message } from "@convex-dev/agent";
import type { ModelMessage } from "ai";
import { v, type Infer } from "convex/values";
import { components, internal } from "../_generated/api";
import { mutation, type MutationCtx } from "../_generated/server";
import { chatAgent } from "../agents/chat";
import { loadPromptAttachments, vAttachmentNotFound } from "../attachments";
import { appError, ERROR_CODES } from "../lib/errors";
import { authorizeThreadAccess, requireUser } from "../lib/guards";
import {
  buildPromptMessage,
  checkPrompt,
  replacePromptText,
  titleFromPrompt,
} from "../lib/prompt";
import { resolveTimeZone, vTimeZone } from "../lib/timeZone";
import { limitSend, vRateLimited } from "../rateLimits";
import { closeUnrunActions } from "./approval";
import { getStoppedReply } from "./stop";
import { getLastTurn, hasPendingReply } from "./turns";

// File IDs from registerUpload (convex/attachments.ts). Each Send checks
// them (loadPromptAttachments).
const vAttachmentFileIds = v.optional(v.array(v.string()));

// startThread, sendMessage, regenerateReply and editPrompt are the Sends.
// Each checks the rate limits (limitSend) before it saves anything. A Send
// over a limit, or with an attachment that's gone, returns the refusal
// instead of throwing it, because the Convex client logs every thrown error
// to the browser console. sendMessage also returns a refusal while a reply
// is running.
//
// startThread and sendMessage load their attachments before the rate limits,
// and sendMessage checks for a running reply first. limitSend counts the
// Send, so a refusal after it would still be counted.

/**
 * Why a Send was refused: the thread's reply is still running. sendMessage
 * returns it instead of throwing.
 */
const vReplyInProgress = v.object({
  code: v.literal(ERROR_CODES.REPLY_IN_PROGRESS),
  message: v.string(),
});

export type ReplyInProgress = Infer<typeof vReplyInProgress>;

const REPLY_IN_PROGRESS: ReplyInProgress = {
  code: ERROR_CODES.REPLY_IN_PROGRESS,
  message: "Wait for the reply to finish first.",
};

export const startThread = mutation({
  args: {
    prompt: v.string(),
    attachmentFileIds: vAttachmentFileIds,
    timeZone: vTimeZone,
  },
  returns: v.union(
    v.object({ threadId: v.string() }),
    vRateLimited,
    vAttachmentNotFound,
  ),
  handler: async (ctx, { prompt, attachmentFileIds = [], timeZone }) => {
    const user = await requireUser(ctx);
    const text = checkPrompt(prompt, attachmentFileIds.length);
    const attachments = await loadPromptAttachments(
      ctx,
      user._id,
      attachmentFileIds,
    );
    if ("code" in attachments) return attachments;
    const refused = await limitSend(ctx, user._id);
    if (refused) return refused;
    // Shown until the generated title replaces it, and kept if that fails.
    // A prompt with no text is titled after its first attachment.
    const placeholder = titleFromPrompt(text || attachments.filenames[0]);
    const threadId = await createThread(ctx, components.agent, {
      userId: user._id,
      title: placeholder,
    });
    await sendPrompt(ctx, {
      threadId,
      message: buildPromptMessage(text, attachments.parts),
      attachmentFileIds: attachments.fileIds,
      timeZone,
    });
    // Runs next to the first reply. Later prompts don't get a title.
    await ctx.scheduler.runAfter(0, internal.titles.generateTitle, {
      threadId,
      userId: user._id,
      prompt: text,
      attachmentFilenames: attachments.filenames,
      placeholder,
    });
    return { threadId };
  },
});

export const sendMessage = mutation({
  args: {
    prompt: v.string(),
    attachmentFileIds: vAttachmentFileIds,
    threadId: v.string(),
    timeZone: vTimeZone,
  },
  returns: v.union(
    v.null(),
    vRateLimited,
    vAttachmentNotFound,
    vReplyInProgress,
  ),
  handler: async (
    ctx,
    { prompt, attachmentFileIds = [], threadId, timeZone },
  ) => {
    const user = await authorizeThreadAccess(ctx, threadId);
    const lastTurn = await getLastTurn(ctx, threadId);
    // A second tab, or a direct call, can send while a reply is running. The
    // new prompt would close the reply's running actions (closeUnrunActions),
    // and a second runner would stream into the thread next to the first.
    if (hasPendingReply(lastTurn)) return REPLY_IN_PROGRESS;
    const text = checkPrompt(prompt, attachmentFileIds.length);
    const attachments = await loadPromptAttachments(
      ctx,
      user._id,
      attachmentFileIds,
    );
    if ("code" in attachments) return attachments;
    const refused = await limitSend(ctx, user._id);
    if (refused) return refused;
    // Nothing above writes to the thread, so lastTurn is still current.
    await closeUnrunActions(ctx, threadId, lastTurn);
    await sendPrompt(ctx, {
      threadId,
      message: buildPromptMessage(text, attachments.parts),
      attachmentFileIds: attachments.fileIds,
      timeZone,
    });
    return null;
  },
});

/**
 * Replaces the thread's last reply with a new reply to the same prompt. The
 * Regenerate button calls this.
 */
export const regenerateReply = mutation({
  args: { threadId: v.string(), timeZone: vTimeZone },
  returns: v.union(v.null(), vRateLimited),
  handler: async (ctx, { threadId, timeZone }) => {
    const user = await authorizeThreadAccess(ctx, threadId);
    const refused = await limitSend(ctx, user._id);
    if (refused) return refused;
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
  returns: v.union(v.null(), vRateLimited),
  handler: async (ctx, { threadId, prompt, timeZone }) => {
    const user = await authorizeThreadAccess(ctx, threadId);
    const refused = await limitSend(ctx, user._id);
    if (refused) return refused;
    // redoLastTurn checks the new text, since it loads the prompt, and a
    // prompt with attachments can have no text.
    await redoLastTurn(ctx, { threadId, timeZone, newText: prompt });
    return null;
  },
});

/**
 * Deletes the thread's last turn, the prompt and its reply, and then sends
 * the prompt again for a new reply. With `newText`, the new prompt has that
 * text in place of the old one, and keeps its attachments. regenerateReply
 * and editPrompt call this.
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
    newText,
  }: { threadId: string; timeZone: string | undefined; newText?: string },
) {
  const turn = await getLastTurn(ctx, threadId);
  const order = turn[0]?.order;
  const prompt = turn.find((message) => message.message?.role === "user");
  if (order === undefined || prompt?.message?.role !== "user") {
    throw appError(ERROR_CODES.NO_PROMPT, "There's no prompt in this chat.");
  }
  if (hasPendingReply(turn)) {
    throw appError(ERROR_CODES.REPLY_IN_PROGRESS, REPLY_IN_PROGRESS.message);
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
  // the prompt is lost. Its attachments go with it. Deleting the old prompt
  // released them, and saving the new one claims them again. This skips
  // closeUnrunActions. The Send that started the deleted turn already closed
  // the turn before it.
  const newPrompt =
    newText === undefined
      ? prompt.message
      : replacePromptText(prompt.message, newText);
  await sendPrompt(ctx, {
    threadId,
    message: newPrompt,
    attachmentFileIds: prompt.fileIds ?? [],
    timeZone,
  });
}

/**
 * Saves a prompt and schedules the reply to it (streamReply). startThread,
 * sendMessage and redoLastTurn all send through here. It leaves the last
 * turn's actions as they are. sendMessage closes them first
 * (closeUnrunActions).
 *
 * `attachmentFileIds` are the files the prompt attaches. Saving them with
 * the prompt keeps the Agent from counting them as unused.
 */
async function sendPrompt(
  ctx: MutationCtx,
  {
    threadId,
    message,
    attachmentFileIds,
    timeZone,
  }: {
    threadId: string;
    message: Message | ModelMessage;
    attachmentFileIds: string[];
    timeZone: string | undefined;
  },
) {
  const { messageId, message: savedPrompt } = await chatAgent.saveMessage(ctx, {
    threadId,
    message,
    metadata:
      attachmentFileIds.length > 0 ? { fileIds: attachmentFileIds } : undefined,
    // we're in a mutation, so skip embeddings for now. They'll be generated
    // lazily when streaming text.
    skipEmbeddings: true,
  });
  await ctx.scheduler.runAfter(0, internal.chat.reply.streamReply, {
    threadId,
    promptMessageId: messageId,
    order: savedPrompt.order,
    timeZone: resolveTimeZone(timeZone),
  });
}
