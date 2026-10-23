import { getThreadMetadata, type MessageDoc } from "@convex-dev/agent";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "../_generated/server";
import { chatAgent } from "../agents/chat";
import { countAutoApproved } from "../lib/autoApprove";
import { getPlanTerms } from "../lib/billing";
import { appError, ERROR_CODES } from "../lib/errors";
import { authorizeThreadAccess } from "../lib/guards";
import { addPendingActions, deletePendingActions } from "../lib/pendingActions";
import { holdReply } from "../lib/creditHolds";
import { settleReplyModel } from "../lib/threadModels";
import { resolveTimeZone, vTimeZone } from "../lib/timeZone";
import { limitSend, vSendLimited } from "../rateLimits";
import { getStoppedReply } from "./stop";
import { getLastTurn } from "./turns";

/** The reason the model gets when the user presses Cancel on an action card. */
const ACTION_CANCELLED = "The user cancelled this action.";

/** The reason the model gets for an action cancelled by a new prompt. */
const ACTION_REPLACED =
  "The user sent a new prompt instead of approving this action.";

/** The reason the model gets for an approved action the user stopped. */
const ACTION_STOPPED = "The user stopped the reply before this action ran.";

/** The reply that ends a turn whose actions the user all cancelled. */
const REPLY_CANCELLED = "Cancelled.";

/**
 * Approves or cancels an action waiting on its card. Approve and Cancel on
 * the card call this.
 *
 * The Agent saves the decision in the thread (ADR 0002), so every open tab
 * shows it. Once the user has decided on every action the step asked for,
 * the reply continues. An approved action runs first. A cancelled one tells
 * the model the user declined.
 *
 * The continuing reply calls the model, so the last decision counts as a
 * Send (limitSend). When limitSend refuses it, this saves nothing and
 * returns the refusal, like a Send, and the card keeps waiting. When the
 * user cancelled every action in the step and none of its actions ran, the
 * turn ends with a fixed reply and no model call, and nothing counts.
 *
 * The reply continues on the thread's model, or on the default model when
 * the thread can't use its model anymore (settleReplyModel).
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
  returns: v.union(v.null(), vSendLimited),
  handler: async (ctx, { threadId, approvalId, approve, timeZone }) => {
    const user = await authorizeThreadAccess(ctx, threadId);
    const turn = await getLastTurn(ctx, threadId);
    const waiting = waitingApprovalIds(turn);
    const order = turn[0]?.order;
    if (
      order === undefined ||
      !waiting.includes(approvalId) ||
      (await getStoppedReply(ctx, threadId, order))
    ) {
      throw appError(
        ERROR_CODES.ACTION_NOT_WAITING,
        "This action was already approved or cancelled.",
      );
    }
    // The check above found this card waiting. Once it's the last, none
    // waits, and the reply continues.
    const last = waiting.length === 1;
    const callsModel = last && (approve || stepHasRunOrApproved(turn));
    const plan = callsModel ? await getPlanTerms(ctx, user._id) : null;
    if (callsModel) {
      const refused = await limitSend(ctx, user._id, plan);
      if (refused) return refused;
    }
    const { messageId } = approve
      ? await chatAgent.approveToolCall(ctx, { threadId, approvalId })
      : await chatAgent.denyToolCall(ctx, {
          threadId,
          approvalId,
          reason: ACTION_CANCELLED,
        });
    if (!last) return null;
    if (!callsModel) {
      await endCancelledTurn(ctx, { threadId, messageId, order });
      return null;
    }
    await deletePendingActions(ctx, threadId);
    // The continuing reply uses the thread's model as it is now. When the
    // thread can't use it anymore, this moves the thread off it, and the
    // composer says why.
    await settleReplyModel(ctx, {
      threadId,
      userId: user._id,
      plan,
      userSend: false,
    });
    await ctx.scheduler.runAfter(0, internal.chat.reply.streamReply, {
      threadId,
      // The Agent continues the reply from the user's decisions.
      promptMessageId: messageId,
      order,
      timeZone: resolveTimeZone(timeZone),
      continuing: true,
      // Each step saves one message from the model.
      stepsTaken: turn.filter((message) => message.message?.role === "assistant")
        .length,
      // The auto-approve cap counts across the whole reply.
      autoApprovedCount: countAutoApproved(turn),
    });
    await holdReply(ctx, {
      userId: user._id,
      threadId,
      promptMessageId: messageId,
    });
    return null;
  },
});

/**
 * Whether the step that paused on action cards ran an action or has one
 * approved, so the model has a result to answer. The step's tool results and
 * the user's decisions come after its message from the model.
 *
 * @param turn The thread's last turn (getLastTurn), newest message first.
 */
function stepHasRunOrApproved(turn: MessageDoc[]): boolean {
  for (const { message } of turn) {
    if (message?.role === "assistant") return false;
    if (message?.role !== "tool") continue;
    const ranOrApproved = message.content.some(
      (part) =>
        part.type === "tool-result" ||
        (part.type === "tool-approval-response" && part.approved),
    );
    if (ranOrApproved) return true;
  }
  return false;
}

/**
 * Ends a turn whose actions the user all cancelled without calling the
 * model. Each cancelled action gets its result (closeUnrunActions), and the
 * reply gets REPLY_CANCELLED. Then it does what streamReply does once a
 * reply ends: records the scheduled run and starts the next queued prompt.
 *
 * @param messageId The user's last decision, which the reply follows.
 */
async function endCancelledTurn(
  ctx: MutationCtx,
  {
    threadId,
    messageId,
    order,
  }: { threadId: string; messageId: string; order: number },
) {
  await closeUnrunActions(ctx, threadId, await getLastTurn(ctx, threadId));
  await chatAgent.saveMessage(ctx, {
    threadId,
    promptMessageId: messageId,
    message: { role: "assistant", content: REPLY_CANCELLED },
    skipEmbeddings: true,
  });
  await ctx.runMutation(internal.scheduledPrompts.recordRunOutcome, {
    threadId,
    promptMessageId: messageId,
    order,
    continuing: true,
    ending: "returned",
  });
  await ctx.runMutation(internal.chat.send.startNextPrompt, { threadId });
}

/**
 * Ends the last turn's actions that never ran, before a new prompt is saved
 * or when the user cancelled them all (endCancelledTurn).
 * A card left waiting is cancelled, so it can't be approved later (ADR
 * 0002). The Agent would only treat it as denied for the next model call.
 * An approved action whose reply the user stopped never runs either. No card
 * waits afterwards, so it deletes the thread's pendingActions row.
 *
 * Each one gets an "execution-denied" result next to the user's decision.
 * The AI SDK leaves decisions out of what it sends the model, and Anthropic
 * refuses a tool call that has no result after it.
 *
 * @param lastTurn The thread's last turn (getLastTurn), newest message
 *   first. It's read again only when cards are cancelled, since cancelling
 *   saves the decisions as new messages.
 */
export async function closeUnrunActions(
  ctx: MutationCtx,
  threadId: string,
  lastTurn: MessageDoc[],
) {
  await deletePendingActions(ctx, threadId);
  if (!hasActionCards(lastTurn)) return;
  const waiting = waitingApprovalIds(lastTurn);
  for (const approvalId of waiting) {
    await chatAgent.denyToolCall(ctx, {
      threadId,
      approvalId,
      reason: ACTION_REPLACED,
    });
  }

  const turn =
    waiting.length > 0 ? await getLastTurn(ctx, threadId) : lastTurn;
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

/**
 * Recounts the cards waiting in the thread's last turn into its
 * pendingActions row. A turn the user stopped counts none, since the client
 * hides its cards. A deleted thread keeps no row.
 */
export async function syncPendingActions(ctx: MutationCtx, threadId: string) {
  const turn = await getLastTurn(ctx, threadId);
  const order = turn[0]?.order;
  const stopped =
    order !== undefined && (await getStoppedReply(ctx, threadId, order));
  const count = stopped ? 0 : waitingApprovalIds(turn).length;
  const thread =
    count > 0
      ? await getThreadMetadata(ctx, components.agent, { threadId }).catch(
          () => null,
        )
      : null;
  if (!thread?.userId) {
    await deletePendingActions(ctx, threadId);
    return;
  }
  await addPendingActions(ctx, { userId: thread.userId, threadId });
}

/**
 * Recounts the thread's waiting cards (syncPendingActions). streamReply
 * calls it once a reply ends, for a reply the user sent and a scheduled run
 * alike.
 */
export const recordPendingActions = internalMutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    await syncPendingActions(ctx, threadId);
    return null;
  },
});

/**
 * Whether any of the turn's actions showed an action card or ran under
 * auto-approve. An auto-approved action the user stopped before it ran
 * needs a result too.
 */
function hasActionCards(turn: MessageDoc[]): boolean {
  return turn.some(
    ({ message }) =>
      Array.isArray(message?.content) &&
      message.content.some((part) => part.type === "tool-approval-request"),
  );
}

/**
 * The approval IDs of the turn's actions that are still waiting on a card.
 * An auto-approved action never waits, since the AI SDK saves its approval
 * in the same step as the request.
 */
export function waitingApprovalIds(turn: MessageDoc[]): string[] {
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
export function isAwaitingContinuation(turn: MessageDoc[]): boolean {
  const content = turn[0]?.message?.content;
  return (
    turn[0]?.message?.role === "tool" &&
    Array.isArray(content) &&
    content.some((part) => part.type === "tool-approval-response") &&
    waitingApprovalIds(turn).length === 0
  );
}
