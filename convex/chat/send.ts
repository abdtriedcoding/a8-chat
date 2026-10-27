import {
  createThread,
  listStreams,
  type Message,
  type MessageDoc,
} from "@convex-dev/agent";
import type { ModelMessage } from "ai";
import { v, type Infer } from "convex/values";
import { components, internal } from "../_generated/api";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "../_generated/server";
import { chatAgent } from "../agents/chat";
import {
  loadPromptAttachments,
  vAttachmentNotFound,
} from "../attachments/load";
import { getPlanTerms, type PlanTerms } from "../lib/billing";
import { appError, ERROR_CODES } from "../lib/errors";
import { authorizeThreadAccess, requireUser } from "../lib/guards";
import {
  buildPromptMessage,
  checkPrompt,
  replacePromptText,
  titleFromPrompt,
} from "../lib/prompt";
import { deletePendingActions } from "../lib/pendingActions";
import { MAX_QUEUED_PROMPTS, REPLY_START_TIMEOUT_MS } from "../lib/queue";
import {
  findThreadScheduledPrompt,
  moveWaitingRun,
} from "../lib/scheduledPrompts";
import type { Model } from "../lib/models";
import {
  checkModelPick,
  getDefaultModel,
  resolveSendModel,
  saveSendModel,
  settleReplyModel,
  setThreadModelRow,
  vModelLocked,
} from "../lib/threadModels";
import { holdReply } from "../lib/creditHolds";
import { resolveTimeZone, vTimeZone } from "../lib/timeZone";
import { checkSpend, limitSend, vSendLimited } from "../rateLimits";
import { setThreadStatus } from "../threads";
import { closeUnrunActions, waitingApprovalIds } from "./approval";
import {
  addQueuedPrompt,
  getPausedQueue,
  isBeingEdited,
  listQueuedPrompts,
  deleteQueuedPromptRows,
  pauseThreadQueue,
  unpauseThreadQueue,
} from "./queue";
import { getStoppedReply, isReplyInProgress } from "./stop";
import { getLastTurn, hasPendingReply } from "./turns";

// File IDs from registerUpload (convex/attachments/upload.ts). Each Send
// checks them (loadPromptAttachments).
const vAttachmentFileIds = v.optional(v.array(v.string()));

// startThread, sendMessage, regenerateReply and editPrompt are the Sends.
// Each checks the rate limits (limitSend) before it saves anything. A Send
// over a limit, or with an attachment that's gone, returns the refusal
// instead of throwing it, because the Convex client logs every thrown error
// to the browser console. sendMessage also returns a refusal when the queue
// is full.
//
// Each Send loads the user's plan terms once (getPlanTerms) and passes them
// to the model checks (lib/threadModels.ts) and the spend check
// (checkSpend), since each load reads Polar's subscriptions and, on Free,
// the user.
//
// startThread and sendMessage load their attachments before the rate limits
// (prepareSend), and sendMessage checks the queue first. limitSend counts
// the Send, so a refusal after it would still be counted.
//
// sendMessage queues its prompt while the thread is busy (convex/chat/
// queue.ts). limitSend counts the prompt when sendMessage queues it, and
// startNextPrompt doesn't count it again. On the hosted a8, startNextPrompt
// checks the user's credits and the daily spend ceiling again (checkSpend),
// since they can run out while the prompt waits.
//
// sendMessage, regenerateReply and editPrompt move an archived thread back
// to the user's chats.
//
// startThread with `temporary` starts a temporary thread (lib/
// temporaryThreads.ts). A thread can't become temporary later, so no other
// Send takes the flag.
//
// startThread with `autoApprove` turns auto-approve on for the new thread
// (lib/autoApprove.ts), so its first reply runs actions without a card.
// After that, setAutoApprove (convex/autoApprove.ts) changes it.
//
// startThread and sendMessage take the model picked in the composer
// (`modelId`) and make it the thread's model (lib/threadModels.ts). A new
// thread without one starts on the user's default model. A pick the user's
// plan doesn't include returns ModelLocked. Every reply uses the thread's
// model at the moment it starts, so a queued prompt, a regenerate and an
// edit use it too. When the thread can't use its model anymore, because it
// left the list or the user's plan changed, each Send moves the thread to
// the default model first (resolveSendModel), and the composer says why.

/**
 * Why a Send was refused: the thread's queue already holds
 * MAX_QUEUED_PROMPTS. sendMessage returns it instead of throwing.
 */
const vQueueFull = v.object({
  code: v.literal(ERROR_CODES.QUEUE_FULL),
  message: v.string(),
});

export type QueueFull = Infer<typeof vQueueFull>;

const QUEUE_FULL: QueueFull = {
  code: ERROR_CODES.QUEUE_FULL,
  message: `You can queue up to ${MAX_QUEUED_PROMPTS} prompts. Wait for one to start.`,
};

const REPLY_IN_PROGRESS_MESSAGE = "Wait for the reply to finish first.";

/** The longest queue key sendMessage keeps. A UUID has 36 characters. */
const MAX_QUEUE_KEY_LENGTH = 64;

export const startThread = mutation({
  args: {
    prompt: v.string(),
    attachmentFileIds: vAttachmentFileIds,
    timeZone: vTimeZone,
    temporary: v.optional(v.boolean()),
    autoApprove: v.optional(v.boolean()),
    modelId: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ threadId: v.string() }),
    vSendLimited,
    vAttachmentNotFound,
    vModelLocked,
  ),
  handler: async (
    ctx,
    {
      prompt,
      attachmentFileIds = [],
      timeZone,
      temporary = false,
      autoApprove = false,
      modelId,
    },
  ) => {
    const user = await requireUser(ctx);
    const plan = await getPlanTerms(ctx, user._id);
    const model = modelId
      ? checkModelPick(plan, modelId)
      : await getDefaultModel(ctx, user._id, plan);
    if ("code" in model) return model;
    const prepared = await prepareSend(
      ctx,
      user._id,
      plan,
      prompt,
      attachmentFileIds,
      model,
    );
    if ("code" in prepared) return prepared;
    const { text, message, attachments } = prepared;
    // Shown until the generated title replaces it, and kept if that fails.
    // A prompt with no text is titled after its first attachment. A
    // temporary thread shows no title, so it gets none.
    const placeholder = temporary
      ? undefined
      : titleFromPrompt(text || attachments.filenames[0]);
    const threadId = await createThread(ctx, components.agent, {
      userId: user._id,
      title: placeholder,
    });
    if (temporary) {
      await ctx.db.insert("temporaryThreads", { userId: user._id, threadId });
    }
    if (autoApprove) {
      await ctx.db.insert("autoApproveThreads", { threadId });
    }
    await setThreadModelRow(ctx, { threadId, modelId: model.id });
    await sendPrompt(ctx, {
      userId: user._id,
      threadId,
      message,
      attachmentFileIds: attachments.fileIds,
      timeZone,
    });
    if (placeholder === undefined) return { threadId };
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
    modelId: v.optional(v.string()),
    // The queue stack's key for the prompt, if it's queued (getQueue).
    queueKey: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    vSendLimited,
    vAttachmentNotFound,
    vQueueFull,
    vModelLocked,
  ),
  handler: async (
    ctx,
    { prompt, attachmentFileIds = [], threadId, timeZone, modelId, queueKey },
  ) => {
    const user = await authorizeThreadAccess(ctx, threadId);
    const plan = await getPlanTerms(ctx, user._id);
    const sendModel = await resolveSendModel(ctx, {
      threadId,
      userId: user._id,
      plan,
      modelId,
    });
    if ("code" in sendModel) return sendModel;
    const { model } = sendModel;
    const [lastTurn, queue, paused] = await Promise.all([
      getLastTurn(ctx, threadId),
      listQueuedPrompts(ctx, threadId),
      getPausedQueue(ctx, threadId),
    ]);
    // Queues while a reply is running, so the prompt doesn't close the
    // reply's actions (closeUnrunActions) or start a second runner next to
    // the first. Also queues behind an unpaused queue with prompts in it,
    // whether an action card is holding it or startNextPrompt is about to
    // start its next prompt. With a paused queue, the prompt is sent right
    // away, before the queued ones.
    const shouldQueue =
      (await isThreadBusy(ctx, threadId, lastTurn)) ||
      (queue.length > 0 && paused === null);
    if (shouldQueue && queue.length >= MAX_QUEUED_PROMPTS) return QUEUE_FULL;
    const prepared = await prepareSend(
      ctx,
      user._id,
      plan,
      prompt,
      attachmentFileIds,
      model,
    );
    if ("code" in prepared) return prepared;
    const { text, message, attachments } = prepared;
    await setThreadStatus(ctx, threadId, "active");
    await saveSendModel(ctx, { threadId, ...sendModel, userSend: true });
    if (shouldQueue) {
      // Leaves the last turn's actions as they are. startNextPrompt starts
      // nothing while a card waits.
      await addQueuedPrompt(ctx, {
        threadId,
        userId: user._id,
        prompt: text,
        attachmentFileIds: attachments.fileIds,
        timeZone,
        // The client makes the key, so sendMessage drops one that's too
        // long rather than save it.
        queueKey:
          queueKey && queueKey.length <= MAX_QUEUE_KEY_LENGTH
            ? queueKey
            : undefined,
      });
      return null;
    }
    // Nothing above writes to the thread's messages, so lastTurn is still
    // current.
    await closeUnrunActions(ctx, threadId, lastTurn);
    await sendPrompt(ctx, {
      userId: user._id,
      threadId,
      message,
      attachmentFileIds: attachments.fileIds,
      timeZone,
    });
    return null;
  },
});

/**
 * Starts the oldest queued prompt as its own turn, if the thread is free.
 * streamReply calls this when a reply ends normally. That includes a reply
 * that paused on action cards, and then this starts nothing. If starting
 * the prompt throws, streamReply pauses the queue. settleStop schedules it
 * too, for a prompt sent while a stopped reply was still running.
 */
export const startNextPrompt = internalMutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    await startNextQueuedPrompt(ctx, threadId, { resuming: false });
    return null;
  },
});

/**
 * Unpauses the thread's queue and starts its oldest prompt. Resume on the
 * queue stack calls this.
 *
 * It works after a failed or stopped reply, and after a reply that never
 * started (isThreadBusy). Throws while a reply is still running or could
 * still start, and when one of the next prompt's attachments is gone. The
 * queue stays paused then. When checkSpend refuses the next prompt, the
 * queue stays paused too, and this returns the refusal, like a Send.
 */
export const resumeQueue = mutation({
  args: { threadId: v.string() },
  returns: v.union(v.null(), vSendLimited),
  handler: async (ctx, { threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    const turn = await getLastTurn(ctx, threadId);
    if (await isThreadBusy(ctx, threadId, turn)) {
      throw appError(ERROR_CODES.REPLY_IN_PROGRESS, REPLY_IN_PROGRESS_MESSAGE);
    }
    await unpauseThreadQueue(ctx, threadId);
    const started = await startNextQueuedPrompt(ctx, threadId, {
      resuming: true,
    });
    if (started === "attachmentGone") {
      throw appError(
        ERROR_CODES.NOT_FOUND,
        "An attachment in the next prompt is gone. Delete the prompt and queue it again.",
      );
    }
    if (started !== null && started !== "started") return started;
    return null;
  },
});

/**
 * Replaces the thread's last reply with a new reply to the same prompt. The
 * Regenerate button calls this.
 */
export const regenerateReply = mutation({
  args: { threadId: v.string(), timeZone: vTimeZone },
  returns: v.union(v.null(), vSendLimited),
  handler: async (ctx, { threadId, timeZone }) => {
    const user = await authorizeThreadAccess(ctx, threadId);
    const plan = await getPlanTerms(ctx, user._id);
    const refused = await limitSend(ctx, user._id, plan);
    if (refused) return refused;
    await redoLastTurn(ctx, { threadId, userId: user._id, plan, timeZone });
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
  returns: v.union(v.null(), vSendLimited),
  handler: async (ctx, { threadId, prompt, timeZone }) => {
    const user = await authorizeThreadAccess(ctx, threadId);
    const plan = await getPlanTerms(ctx, user._id);
    const refused = await limitSend(ctx, user._id, plan);
    if (refused) return refused;
    // redoLastTurn checks the new text, since it loads the prompt, and a
    // prompt with attachments can have no text.
    await redoLastTurn(ctx, {
      threadId,
      userId: user._id,
      plan,
      timeZone,
      newText: prompt,
    });
    return null;
  },
});

/**
 * Runs the steps startThread and sendMessage share before they save the
 * prompt. Checks the prompt, loads its attachments for `model`, the
 * reply's model, and counts the Send (limitSend) against the user's plan
 * terms. Returns the checked text, the prompt's message and the
 * attachments, or the refusal to return.
 */
async function prepareSend(
  ctx: MutationCtx,
  userId: string,
  plan: PlanTerms | null,
  prompt: string,
  attachmentFileIds: string[],
  model: Model,
) {
  const text = checkPrompt(prompt, attachmentFileIds.length);
  const attachments = await loadPromptAttachments(
    ctx,
    userId,
    attachmentFileIds,
    model,
  );
  if ("code" in attachments) return attachments;
  const refused = await limitSend(ctx, userId, plan);
  if (refused) return refused;
  return {
    text,
    message: buildPromptMessage(text, attachments.parts),
    attachments,
  };
}

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
 * The new reply uses the thread's model, or the default model when the
 * thread can't use its model anymore (settleReplyModel).
 *
 * Throws while the reply is still on its way. That includes a stopped reply
 * that its runner hasn't saved yet, which takes a moment.
 */
async function redoLastTurn(
  ctx: MutationCtx,
  {
    threadId,
    userId,
    plan,
    timeZone,
    newText,
  }: {
    threadId: string;
    userId: string;
    plan: PlanTerms | null;
    timeZone: string | undefined;
    newText?: string;
  },
) {
  const turn = await getLastTurn(ctx, threadId);
  const order = turn[0]?.order;
  const prompt = turn.find((message) => message.message?.role === "user");
  if (order === undefined || prompt?.message?.role !== "user") {
    throw appError(ERROR_CODES.NO_PROMPT, "There's no prompt in this chat.");
  }
  if (hasPendingReply(turn)) {
    throw appError(ERROR_CODES.REPLY_IN_PROGRESS, REPLY_IN_PROGRESS_MESSAGE);
  }
  await setThreadStatus(ctx, threadId, "active");
  await settleReplyModel(ctx, { threadId, userId, plan, userSend: true });

  // The Agent also aborts any stream still running at this order.
  await chatAgent.deleteMessages(ctx, {
    messageIds: turn.map((message) => message._id),
  });
  // The deleted turn took its waiting cards with it.
  await deletePendingActions(ctx, threadId);
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
  const newPromptId = await sendPrompt(ctx, {
    userId,
    threadId,
    message: newPrompt,
    attachmentFileIds: prompt.fileIds ?? [],
    timeZone,
  });
  // A scheduled run redone this way is still its scheduled prompt's
  // waiting run.
  await moveWaitingRun(
    ctx,
    await findThreadScheduledPrompt(ctx, threadId),
    { promptMessageId: prompt._id },
    newPromptId,
  );
}

/**
 * Starts the thread's oldest queued prompt. It takes the prompt off the
 * queue, loads its attachments and sends it as sendMessage would. It isn't
 * counted again, since queueing it counted it. A queued scheduled run keeps
 * counting as its scheduled prompt's waiting run (moveWaitingRun).
 *
 * Starts nothing while the queue is paused, the user is editing the oldest
 * prompt (startQueuedPromptEdit), an action card waits or a reply is running or
 * could still start (isThreadBusy). Unless `resuming`,
 * it also pauses the queue after a failed reply, since the runner doesn't
 * always see the failure. A stopped reply with no text is saved as failed
 * too, and doesn't pause it. It pauses the queue too if one of the prompt's
 * attachments is gone, and returns "attachmentGone" then.
 *
 * On the hosted a8 the prompt has to pass checkSpend as it starts. When it
 * doesn't, this pauses the queue and returns the refusal. checkSpend would
 * refuse a queued scheduled run too, so the run leaves the queue and counts
 * as a failed run, wherever it waits in the queue. Otherwise the paused
 * queue would hold it, and every later run would be skipped.
 */
async function startNextQueuedPrompt(
  ctx: MutationCtx,
  threadId: string,
  { resuming }: { resuming: boolean },
) {
  const [next] = await listQueuedPrompts(ctx, threadId);
  if (!next || isBeingEdited(next) || (await getPausedQueue(ctx, threadId))) {
    return null;
  }
  const turn = await getLastTurn(ctx, threadId);
  if (
    waitingApprovalIds(turn).length > 0 ||
    (await isThreadBusy(ctx, threadId, turn))
  ) {
    return null;
  }
  const latest = turn[0];
  if (
    !resuming &&
    latest?.status === "failed" &&
    !(await getStoppedReply(ctx, threadId, latest.order))
  ) {
    await pauseThreadQueue(ctx, threadId);
    return null;
  }
  const plan = await getPlanTerms(ctx, next.userId);
  const attachments = await loadPromptAttachments(
    ctx,
    next.userId,
    next.attachmentFileIds,
    await settleReplyModel(ctx, {
      threadId,
      userId: next.userId,
      plan,
      userSend: false,
    }),
  );
  if ("code" in attachments) {
    await pauseThreadQueue(ctx, threadId);
    return "attachmentGone";
  }
  const refused = await checkSpend(ctx, next.userId, plan);
  if (refused) {
    for (const queued of await listQueuedPrompts(ctx, threadId)) {
      if (!queued.scheduledPromptId) continue;
      await deleteQueuedPromptRows(ctx, queued);
      await ctx.runMutation(internal.scheduledPrompts.recordRefusedRun, {
        scheduledPromptId: queued.scheduledPromptId,
        message: refused.message,
      });
    }
    await pauseThreadQueue(ctx, threadId);
    return refused;
  }
  await deleteQueuedPromptRows(ctx, next);
  // No card is waiting, so this cancels nothing the user hasn't seen. It
  // ends approved actions that never ran, like one in a stopped reply,
  // which Anthropic needs a result for.
  await closeUnrunActions(ctx, threadId, turn);
  const promptMessageId = await sendPrompt(ctx, {
    userId: next.userId,
    threadId,
    message: buildPromptMessage(next.prompt, attachments.parts),
    attachmentFileIds: attachments.fileIds,
    timeZone: next.timeZone,
  });
  if (next.scheduledPromptId) {
    await moveWaitingRun(
      ctx,
      await ctx.db.get("scheduledPrompts", next.scheduledPromptId),
      { queuedPromptId: next._id },
      promptMessageId,
    );
  }
  return "started";
}

/**
 * Whether the thread's last turn still has a reply on its way. That's when
 * one is running (hasPendingReply), or one could still start
 * (isReplyInProgress), the user didn't stop it, and REPLY_START_TIMEOUT_MS
 * hasn't passed. The client shows a stopped turn as over, and a runner that
 * saw the stop before it started never replies. After the timeout the
 * client gives up on the reply too (the "timedOut" reply status), so a Send
 * goes right away and Resume works.
 *
 * @param turn The thread's last turn (getLastTurn), newest message first.
 */
export async function isThreadBusy(
  ctx: MutationCtx,
  threadId: string,
  turn: MessageDoc[],
) {
  if (hasPendingReply(turn)) return true;
  const latest = turn[0];
  if (!latest || !isReplyInProgress(turn)) return false;
  if (Date.now() - latest._creationTime >= REPLY_START_TIMEOUT_MS) {
    return false;
  }
  return !(await getStoppedReply(ctx, threadId, latest.order));
}

/**
 * Saves a prompt, schedules the reply to it (streamReply), holds credits
 * for the reply (holdReply) and returns the prompt's message id. startThread, sendMessage, startNextQueuedPrompt,
 * redoLastTurn and a scheduled run (convex/scheduledPrompts.ts) all send
 * through here. It leaves the last turn's actions as they are.
 * sendMessage, startNextQueuedPrompt and a scheduled run close them first
 * (closeUnrunActions).
 *
 * `attachmentFileIds` are the files the prompt attaches. Saving them with
 * the prompt keeps the Agent from counting them as unused.
 */
export async function sendPrompt(
  ctx: MutationCtx,
  {
    userId,
    threadId,
    message,
    attachmentFileIds,
    timeZone,
  }: {
    userId: string;
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
  await holdReply(ctx, { userId, threadId, promptMessageId: messageId });
  return messageId;
}
