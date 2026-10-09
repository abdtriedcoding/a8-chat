// See the docs at https://docs.convex.dev/agents/streaming
import {
  abortStream,
  createThread,
  listMessages,
  listStreams,
  stepCountIs,
  syncStreams,
  toUIMessages,
  vStreamArgs,
  type Message,
  type MessageDoc,
  type StreamArgs,
  type SyncStreamsReturnValue,
} from "@convex-dev/agent";
import type { FilePart, ImagePart, ModelMessage } from "ai";
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
import {
  chatAgent,
  MAX_REPLY_STEPS,
  MAX_STEPS_WITHOUT_CONNECTORS,
  nativeTools,
} from "./agents/chat";
import { loadPromptAttachments, vAttachmentNotFound } from "./attachments";
import { requireUser } from "./auth";
import {
  createConnectorTools,
  type ConnectorTools,
} from "./lib/connectorTools";
import { replyInstructions } from "./lib/instructions";
import { checkPrompt, titleFromPrompt } from "./lib/prompt";
import { replyFailureReason } from "./lib/replyFailure";
import { canSearchWeb } from "./lib/searchWeb";
import { resolveTimeZone } from "./lib/timeZone";
import { limitSend, vRateLimited } from "./rateLimits";
import { authorizeThreadAccess, getOwnThread } from "./threads";

// The browser's time zone, unchecked. Each Send checks it (resolveTimeZone).
const vTimeZone = v.optional(v.string());

// File IDs from registerUpload (convex/attachments.ts). Each Send checks
// them (loadPromptAttachments).
const vAttachmentFileIds = v.optional(v.array(v.string()));

/**
 * The reason we give when the user presses Stop. It's passed to abortStream,
 * and saved as the error on a stopped reply that we hide.
 */
const STOPPED = "Stopped by the user";

/**
 * How long a reply can run before its next step has to be its last. Convex
 * stops an action at 10 minutes, so this leaves time for the final text.
 */
const REPLY_TIME_LIMIT_MS = 8 * 60 * 1000;

/**
 * The most messages one turn holds: the prompt, and for each step of the
 * reply the model's message and its tool results. A step that paused on
 * action cards also saves the user's decisions, and the results of the
 * actions they approved.
 */
const MAX_TURN_MESSAGES = 4 * MAX_REPLY_STEPS + 1;

/** The reason the model gets when the user presses Cancel on an action card. */
const ACTION_CANCELLED = "The user cancelled this action.";

/** The reason the model gets for an action cancelled by a new prompt. */
const ACTION_REPLACED =
  "The user sent a new prompt instead of approving this action.";

/** The reason the model gets for an approved action the user stopped. */
const ACTION_STOPPED = "The user stopped the reply before this action ran.";

/**
 * Extra data listThreadMessages adds to every message in a turn. Messages
 * in other turns get none.
 * - `stopped`: the user stopped the turn's reply. `keepText` says whether
 *   the reply's text should still be shown.
 * - `failureReason`: the reply failed for a reason we know, and this says
 *   what it is, such as attachments too large for the model.
 * - `continuing`: the user has decided on every action card in the reply,
 *   and the runner hasn't picked the reply up again yet.
 */
export type MessageMetadata = {
  stopped?: { keepText: boolean };
  failureReason?: string;
  continuing?: boolean;
};

// startThread, sendMessage, regenerateReply and editPrompt are the Sends.
// Each checks the rate limits (limitSend) before it saves anything. A Send
// over a limit, or with an attachment that's gone, returns the refusal
// instead of throwing it, because the Convex client logs every thrown error
// to the browser console.
//
// startThread and sendMessage load their attachments before the rate limits.
// limitSend counts the Send, so a refusal after it would still be counted.

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
  returns: v.union(v.null(), vRateLimited, vAttachmentNotFound),
  handler: async (
    ctx,
    { prompt, attachmentFileIds = [], threadId, timeZone },
  ) => {
    const user = await authorizeThreadAccess(ctx, threadId);
    const text = checkPrompt(prompt, attachmentFileIds.length);
    const attachments = await loadPromptAttachments(
      ctx,
      user._id,
      attachmentFileIds,
    );
    if ("code" in attachments) return attachments;
    const refused = await limitSend(ctx, user._id);
    if (refused) return refused;
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
 * A new prompt's message: its attachments first, then its text. With no
 * attachments, just the text.
 */
function buildPromptMessage(
  text: string,
  attachmentParts: Array<ImagePart | FilePart>,
): ModelMessage {
  if (attachmentParts.length === 0) return { role: "user", content: text };
  return {
    role: "user",
    content: text
      ? [...attachmentParts, { type: "text", text }]
      : attachmentParts,
  };
}

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
  // the prompt is lost. Its attachments go with it. Deleting the old prompt
  // released them, and saving the new one claims them again.
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

type UserMessage = Extract<Message, { role: "user" }>;

/**
 * The prompt with its text replaced by `newText`. Image and file parts stay,
 * and the new text goes after them. Throws if the new text is blank and the
 * prompt has no attachments (checkPrompt).
 */
function replacePromptText(prompt: UserMessage, newText: string): UserMessage {
  if (typeof prompt.content === "string") {
    return { ...prompt, content: checkPrompt(newText, 0) };
  }
  const attachmentParts = prompt.content.filter((part) => part.type !== "text");
  const checkedText = checkPrompt(newText, attachmentParts.length);
  return {
    ...prompt,
    content: checkedText
      ? [...attachmentParts, { type: "text", text: checkedText }]
      : attachmentParts,
  };
}

/**
 * Saves a prompt and schedules the reply to it (streamReply). startThread,
 * sendMessage and redoLastTurn all send through here.
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
  await closeUnrunActions(ctx, threadId);
  const { messageId, message: savedPrompt } = await chatAgent.saveMessage(ctx, {
    threadId,
    message,
    metadata:
      attachmentFileIds.length > 0 ? { fileIds: attachmentFileIds } : undefined,
    // we're in a mutation, so skip embeddings for now. They'll be generated
    // lazily when streaming text.
    skipEmbeddings: true,
  });
  await ctx.scheduler.runAfter(0, internal.chat.streamReply, {
    threadId,
    promptMessageId: messageId,
    order: savedPrompt.order,
    timeZone: resolveTimeZone(timeZone),
  });
}

/**
 * Approves or cancels an action waiting on its card. Approve and Cancel on
 * the card call this. It isn't a Send, because it continues the same reply,
 * so the send limits don't count it.
 *
 * The Agent saves the decision in the thread (ADR 0002), so every open tab
 * shows it. Once the user has decided on every action the step asked for,
 * the reply continues. An approved action runs first. A cancelled one tells
 * the model the user declined.
 *
 * Throws if the action isn't waiting anymore: another tab decided on it, a
 * new prompt cancelled it, or a regenerate or an edit replaced its turn.
 */
export const decideAction = mutation({
  args: {
    threadId: v.string(),
    approvalId: v.string(),
    approve: v.boolean(),
    timeZone: vTimeZone,
  },
  returns: v.null(),
  handler: async (ctx, { threadId, approvalId, approve, timeZone }) => {
    await authorizeThreadAccess(ctx, threadId);
    const turn = await getLastTurn(ctx, threadId);
    const waiting = waitingApprovalIds(turn);
    const order = turn[0]?.order;
    if (
      order === undefined ||
      !waiting.includes(approvalId) ||
      (await getStoppedReply(ctx, threadId, order))
    ) {
      throw new ConvexError({
        code: "ACTION_NOT_WAITING",
        message: "This action was already approved or cancelled.",
      });
    }
    const { messageId } = approve
      ? await chatAgent.approveToolCall(ctx, { threadId, approvalId })
      : await chatAgent.denyToolCall(ctx, {
          threadId,
          approvalId,
          reason: ACTION_CANCELLED,
        });
    if (waiting.length > 1) return null;
    await ctx.scheduler.runAfter(0, internal.chat.streamReply, {
      threadId,
      // The Agent continues the reply from the user's decisions.
      promptMessageId: messageId,
      order,
      timeZone: resolveTimeZone(timeZone),
      // Each step saves one message from the model.
      stepsTaken: turn.filter((message) => message.message?.role === "assistant")
        .length,
    });
    return null;
  },
});

/** The thread's last turn, newest message first, with every status. */
async function getLastTurn(
  ctx: QueryCtx,
  threadId: string,
): Promise<MessageDoc[]> {
  const { page } = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { numItems: MAX_TURN_MESSAGES, cursor: null },
  });
  const order = page[0]?.order;
  return page.filter((message) => message.order === order);
}

/**
 * Ends the last turn's actions that never ran, before a new prompt is saved.
 * A card left waiting is cancelled, so it can't be approved later (ADR
 * 0002). The Agent would only treat it as denied for the next model call.
 * An approved action whose reply the user stopped never runs either.
 *
 * Each one gets an "execution-denied" result next to the user's decision.
 * The AI SDK leaves decisions out of what it sends the model, and Anthropic
 * refuses a tool call that has no result after it.
 */
async function closeUnrunActions(ctx: MutationCtx, threadId: string) {
  for (const approvalId of waitingApprovalIds(
    await getLastTurn(ctx, threadId),
  )) {
    await chatAgent.denyToolCall(ctx, {
      threadId,
      approvalId,
      reason: ACTION_REPLACED,
    });
  }

  const turn = await getLastTurn(ctx, threadId);
  const toolNames = new Map<string, string>();
  const toolCallIds = new Map<string, string>();
  const ran = new Set<string>();
  for (const { message } of turn) {
    if (!message || typeof message.content === "string") continue;
    for (const part of message.content) {
      if (part.type === "tool-call") {
        toolNames.set(part.toolCallId, part.toolName);
      } else if (part.type === "tool-approval-request") {
        toolCallIds.set(part.approvalId, part.toolCallId);
      } else if (part.type === "tool-result") {
        ran.add(part.toolCallId);
      }
    }
  }
  for (const { _id, message } of turn) {
    if (message?.role !== "tool") continue;
    const results = message.content.flatMap((part) => {
      if (part.type !== "tool-approval-response") return [];
      const toolCallId = toolCallIds.get(part.approvalId);
      if (toolCallId === undefined || ran.has(toolCallId)) return [];
      return [
        {
          type: "tool-result" as const,
          toolCallId,
          toolName: toolNames.get(toolCallId) ?? "",
          output: {
            type: "execution-denied" as const,
            reason: part.approved ? ACTION_STOPPED : part.reason,
          },
        },
      ];
    });
    if (results.length === 0) continue;
    await chatAgent.updateMessage(ctx, {
      messageId: _id,
      patch: {
        message: { role: "tool", content: [...message.content, ...results] },
        status: "success",
      },
    });
  }
}

/** The approval IDs of the turn's actions that are still waiting on a card. */
function waitingApprovalIds(turn: MessageDoc[]): string[] {
  const requested: string[] = [];
  const decided = new Set<string>();
  for (const { message } of turn) {
    if (!message || typeof message.content === "string") continue;
    for (const part of message.content) {
      if (part.type === "tool-approval-request") {
        requested.push(part.approvalId);
      } else if (part.type === "tool-approval-response") {
        decided.add(part.approvalId);
      }
    }
  }
  return requested.filter((approvalId) => !decided.has(approvalId));
}

/**
 * Whether the turn's reply is waiting for the runner to continue it. That's
 * when its newest message holds the user's decisions on action cards, and
 * no card is still waiting.
 *
 * @param turn The turn's messages, newest first.
 */
function isAwaitingContinuation(turn: MessageDoc[]): boolean {
  const content = turn[0]?.message?.content;
  return (
    turn[0]?.message?.role === "tool" &&
    Array.isArray(content) &&
    content.some((part) => part.type === "tool-approval-response") &&
    waitingApprovalIds(turn).length === 0
  );
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

    const turn = await getLastTurn(ctx, threadId);
    const latest = turn[0];
    // The reply is still coming if the newest message is a pending reply,
    // or the runner hasn't saved anything since the user's prompt or their
    // decisions on action cards.
    const inProgress =
      latest?.status === "pending" ||
      latest?.message?.role === "user" ||
      isAwaitingContinuation(turn);
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
 * as it arrives. sendPrompt schedules it, and decideAction schedules it
 * again to continue a reply that paused on action cards.
 */
export const streamReply = internalAction({
  args: {
    // The prompt, or the user's decisions on action cards when continuing.
    promptMessageId: v.string(),
    threadId: v.string(),
    // The prompt's order. The reply gets the same one.
    order: v.number(),
    timeZone: v.string(),
    // The steps the reply took before it paused on action cards.
    stepsTaken: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { promptMessageId, threadId, order, timeZone, stepsTaken = 0 },
  ) => {
    const startedAt = Date.now();
    let connectorTools: ConnectorTools | undefined;
    try {
      // Skip the model call if the user pressed Stop first, or a regenerate
      // or an edit replaced this turn.
      const canReply = await ctx.runQuery(internal.chat.canReply, {
        threadId,
        promptMessageId,
        order,
      });
      if (!canReply) return;
      const connections = await ctx.runQuery(
        internal.connectors.listReplyConnections,
        { threadId },
      );
      connectorTools = await createConnectorTools(ctx, connections);
      const tools = { ...nativeTools, ...connectorTools.tools };
      // The cap counts steps across the whole reply, but the Agent's count
      // starts over when a reply continues after an action card (ADR 0002).
      const maxSteps = Math.max(
        1,
        (Object.keys(connectorTools.tools).length > 0
          ? MAX_REPLY_STEPS
          : MAX_STEPS_WITHOUT_CONNECTORS) - stepsTaken,
      );
      const result = await chatAgent.streamText(
        ctx,
        { threadId },
        {
          promptMessageId,
          instructions: replyInstructions({
            timeZone,
            now: new Date(),
            canSearchWeb,
            connections,
          }),
          tools,
          toolApproval: connectorTools.toolApproval,
          stopWhen: stepCountIs(maxSteps),
          // The last step can't call tools, so a reply that hits the step
          // cap or runs long still ends with text. "none" keeps the tools
          // defined, which Anthropic needs when earlier steps called them.
          prepareStep: ({ stepNumber }) =>
            stepNumber === maxSteps - 1 ||
            Date.now() - startedAt >= REPLY_TIME_LIMIT_MS
              ? { toolChoice: "none" }
              : {},
        },
        // more custom delta options (`true` uses defaults)
        { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
      );
      // We need to make sure the stream finishes - by awaiting each chunk
      // or using this call to consume it all.
      await result.consumeStream();
    } finally {
      await connectorTools?.close();
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
        paginationOpts: { numItems: MAX_TURN_MESSAGES, cursor: null },
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
        turnMetadata.set(row.order, { stopped: { keepText: row.keepText } });
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
          ...message,
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
