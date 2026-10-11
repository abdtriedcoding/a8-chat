import { abortStream } from "@convex-dev/agent";
import { v } from "convex/values";
import { components } from "../_generated/api";
import {
  internalMutation,
  mutation,
  type QueryCtx,
} from "../_generated/server";
import { authorizeThreadAccess } from "../lib/guards";
import { isAwaitingContinuation } from "./approval";
import { getLastTurn, listTurnUpTo } from "./turns";

/**
 * The reason we give when the user presses Stop. It's passed to abortStream,
 * and saved as the error on a stopped reply that we hide.
 */
const STOPPED = "Stopped by the user";

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
    // belongs to a new turn, and that turn can have its own stop.
    // listTurnUpTo returns null then, so the new reply stays as it is.
    const turn = await listTurnUpTo(ctx, { threadId, promptMessageId, order });
    for (const message of turn ?? []) {
      if (message.message?.role === "user") continue;
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
