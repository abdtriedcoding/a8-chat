import type { MessageDoc } from "@convex-dev/agent";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { mutation, type MutationCtx } from "../_generated/server";
import { chatAgent } from "../agents/chat";
import { appError, ERROR_CODES } from "../lib/errors";
import { authorizeThreadAccess } from "../lib/guards";
import { resolveTimeZone, vTimeZone } from "../lib/timeZone";
import { getStoppedReply } from "./stop";
import { getLastTurn } from "./turns";

/** The reason the model gets when the user presses Cancel on an action card. */
const ACTION_CANCELLED = "The user cancelled this action.";

/** The reason the model gets for an action cancelled by a new prompt. */
const ACTION_REPLACED =
  "The user sent a new prompt instead of approving this action.";

/** The reason the model gets for an approved action the user stopped. */
const ACTION_STOPPED = "The user stopped the reply before this action ran.";

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
      throw appError(
        ERROR_CODES.ACTION_NOT_WAITING,
        "This action was already approved or cancelled.",
      );
    }
    const { messageId } = approve
      ? await chatAgent.approveToolCall(ctx, { threadId, approvalId })
      : await chatAgent.denyToolCall(ctx, {
          threadId,
          approvalId,
          reason: ACTION_CANCELLED,
        });
    if (waiting.length > 1) return null;
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
    });
    return null;
  },
});

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
export async function closeUnrunActions(ctx: MutationCtx, threadId: string) {
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
export function isAwaitingContinuation(turn: MessageDoc[]): boolean {
  const content = turn[0]?.message?.content;
  return (
    turn[0]?.message?.role === "tool" &&
    Array.isArray(content) &&
    content.some((part) => part.type === "tool-approval-response") &&
    waitingApprovalIds(turn).length === 0
  );
}
