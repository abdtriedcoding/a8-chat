import { abortStream, type MessageDoc } from "@convex-dev/agent";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import {
  internalMutation,
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { authorizeThreadAccess } from "../lib/guards";
import { isAwaitingContinuation } from "./approval";
import { pauseThreadQueue } from "./queue";
import { getLastTurn, listTurnUpTo } from "./turns";

/** The reason we give abortStream when the user presses Stop. */
const STOPPED = "Stopped by the user";

/**
 * When retryStop tries again: first after FIRST_RETRY_MS, then twice as long
 * each time, until the wait passes LAST_RETRY_MS. That's 6 tries over about
 * 16 seconds. The runner can take a few seconds between its stop check and
 * its stream, mostly opening connector tools.
 */
const FIRST_RETRY_MS = 250;
const LAST_RETRY_MS = 8000;

/**
 * Stops the reply the thread is waiting for. The Stop button calls this.
 *
 * It saves a stoppedReplies row, then aborts the reply's stream. The runner
 * (streamReply) sees the abort the next time it saves text, and cancels the
 * model call. If the stream doesn't exist yet, the row stops the reply when
 * the runner checks for it before calling the model. If the runner checked
 * already, retryStop aborts the stream once it exists.
 *
 * It doesn't change the reply message. The runner is still saving text
 * every 100 ms, so changing the message here would clash with it. The runner
 * cleans up the reply itself after the abort (settleStop).
 *
 * It also pauses the thread's queue, so its prompts don't start right after
 * a reply the user stopped. Beyond that, it does nothing if the reply has
 * already finished.
 */
export const stopReply = mutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    await pauseThreadQueue(ctx, threadId);

    const order = await getOrderInProgress(ctx, threadId);
    if (order === null) return null;
    if (!(await getStoppedReply(ctx, threadId, order))) {
      await ctx.db.insert("stoppedReplies", { threadId, order });
    }
    if (!(await abortReply(ctx, threadId, order))) {
      await scheduleStopRetry(ctx, {
        threadId,
        order,
        delayMs: FIRST_RETRY_MS,
      });
    }
    return null;
  },
});

/**
 * Tries again to abort a stopped reply whose stream didn't exist when the
 * user pressed Stop. Stops trying once the abort lands, the reply is over,
 * or a regenerate or an edit removed the stop. When the runner saw the stop
 * before it started, every try finds nothing to abort.
 */
export const retryStop = internalMutation({
  args: { threadId: v.string(), order: v.number(), delayMs: v.number() },
  returns: v.null(),
  handler: async (ctx, { threadId, order, delayMs }) => {
    if (!(await getStoppedReply(ctx, threadId, order))) return null;
    if ((await getOrderInProgress(ctx, threadId)) !== order) return null;
    if (await abortReply(ctx, threadId, order)) return null;
    const nextDelayMs = delayMs * 2;
    if (nextDelayMs <= LAST_RETRY_MS) {
      await scheduleStopRetry(ctx, { threadId, order, delayMs: nextDelayMs });
    }
    return null;
  },
});

async function scheduleStopRetry(
  ctx: MutationCtx,
  args: { threadId: string; order: number; delayMs: number },
) {
  await ctx.scheduler.runAfter(
    args.delayMs,
    internal.chat.stop.retryStop,
    args,
  );
}

/**
 * Cleans up a stopped reply after the runner sees its stream aborted.
 * Does nothing if the user didn't stop the reply, or if a regenerate or an
 * edit replaced the turn.
 *
 * When a stream is aborted, the Agent saves the partial reply as failed.
 * The model never sees failed messages, so a failed reply that has text
 * becomes a success. The model then sees it, and "continue" works. A reply
 * with no text stays failed, so the model doesn't get an empty message.
 */
export const settleStop = internalMutation({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
    order: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { threadId, promptMessageId, order }) => {
    if (!(await getStoppedReply(ctx, threadId, order))) return null;
    // stopReply paused the queue, but a prompt can join it after the Stop,
    // while the reply is still running. This pauses that queue too.
    await pauseThreadQueue(ctx, threadId);
    // After a regenerate or an edit deletes this prompt, the same order
    // belongs to a new turn, and that turn can have its own stop.
    // listTurnUpTo returns null then, so the new reply stays as it is.
    const turn = await listTurnUpTo(ctx, { threadId, promptMessageId, order });
    for (const message of turn ?? []) {
      if (message.message?.role === "user") continue;
      if (message.status === "failed" && message.text?.trim()) {
        // The Agent's "async abort" error stays on the message, because a
        // patch can't remove a field.
        await ctx.runMutation(components.agent.messages.updateMessage, {
          messageId: message._id,
          patch: { status: "success" },
        });
      }
    }
    return null;
  },
});

/** The turn's stoppedReplies row, or null if the user didn't stop it. */
export async function getStoppedReply(
  ctx: QueryCtx,
  threadId: string,
  order: number,
) {
  return await ctx.db
    .query("stoppedReplies")
    .withIndex("by_threadId_and_order", (q) =>
      q.eq("threadId", threadId).eq("order", order),
    )
    .unique();
}

/**
 * The order of the turn whose reply is still coming, or null if no reply
 * is (isReplyInProgress).
 */
async function getOrderInProgress(ctx: QueryCtx, threadId: string) {
  const turn = await getLastTurn(ctx, threadId);
  const latest = turn[0];
  return latest && isReplyInProgress(turn) ? latest.order : null;
}

/**
 * Whether the turn's reply is still coming. It is if the newest message is
 * a pending reply, or the runner hasn't saved anything since the user's
 * prompt or their decisions on action cards. Stop and the queue both go by
 * this.
 *
 * @param turn The thread's last turn (getLastTurn), newest message first.
 */
export function isReplyInProgress(turn: MessageDoc[]): boolean {
  const latest = turn[0];
  return (
    latest?.status === "pending" ||
    latest?.message?.role === "user" ||
    isAwaitingContinuation(turn)
  );
}

/** Aborts the turn's reply stream. False if it has none streaming. */
async function abortReply(ctx: MutationCtx, threadId: string, order: number) {
  return await abortStream(ctx, components.agent, {
    threadId,
    order,
    reason: STOPPED,
  });
}
