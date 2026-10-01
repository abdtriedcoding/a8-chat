import { abortStream, listMessages } from "@convex-dev/agent";
import { components, internal } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_REPLY_STEPS } from "./reply";

/** The abort reason a stopped reply's stream carries. */
export const STOPPED = "Stopped by the user";

/**
 * Stops the thread's last reply while it's in progress; does nothing once
 * it's done. The stoppedReplies row is what the reply runner checks, so a
 * stop pressed before the reply starts still holds. Aborting only marks the
 * reply's stream: the runner notices on its next write and cancels the
 * model call. The caller checks the thread's owner.
 *
 * `keepText` is false when the user stopped before seeing any of the
 * reply's text: some may have streamed already, but it goes too, so a stop
 * during "Thinking…" never turns into a reply.
 *
 * Saving the text so far is scheduled rather than done here: until the
 * abort commits, the runner adds a delta every 100 ms, so a transaction
 * that read them would keep conflicting until the reply ended.
 */
export async function stop(
  ctx: MutationCtx,
  threadId: string,
  keepText: boolean,
): Promise<void> {
  const {
    page: [latest],
  } = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { numItems: 1, cursor: null },
  });
  // The prompt is the latest message until the runner saves a pending reply.
  const inProgress =
    latest?.status === "pending" || latest?.message?.role === "user";
  if (!latest || !inProgress) return;

  const { order } = latest;
  if (!(await stoppedReply(ctx, threadId, order))) {
    await ctx.db.insert("stoppedReplies", { threadId, order, keepText });
  }
  await abortStream(ctx, components.agent, { threadId, order, reason: STOPPED });
  if (latest.status === "pending") {
    await ctx.scheduler.runAfter(0, internal.chat.saveStopped, {
      threadId,
      order,
    });
  }
}

/**
 * Saves a stopped reply's text as a normal reply, so the model sees it next
 * turn; does nothing for a turn that wasn't stopped. Left alone, the Agent
 * saves it as failed, and failed replies are left out of what the model
 * sees. A reply whose text goes, or that had none (it would reach the model
 * as a blank turn), is saved as failed. Runs right after the stop, and again
 * when the runner finishes, for anything it saved in between.
 */
export async function saveStoppedReply(
  ctx: MutationCtx,
  threadId: string,
  order: number,
): Promise<void> {
  const stopped = await stoppedReply(ctx, threadId, order);
  if (!stopped) return;
  // Newest first, and one reply's steps fit: the stopped turn is the last.
  const { page } = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { numItems: 2 * MAX_REPLY_STEPS, cursor: null },
    statuses: ["pending", "failed"],
  });
  for (const message of page) {
    if (message.order !== order) continue;
    if (message.status === "pending") {
      // Rebuilds the reply from its stream, which the stop ended.
      await ctx.runMutation(components.agent.messages.finalizeMessage, {
        messageId: message._id,
        result: stopped.keepText
          ? { status: "success" }
          : { status: "failed", error: STOPPED },
      });
      if (stopped.keepText) {
        const [saved] = await ctx.runQuery(
          components.agent.messages.getMessagesByIds,
          { messageIds: [message._id] },
        );
        if (!saved?.text?.trim()) {
          await ctx.runMutation(components.agent.messages.updateMessage, {
            messageId: message._id,
            patch: { status: "failed", error: STOPPED },
          });
        }
      }
    } else if (stopped.keepText && message.text?.trim()) {
      // Keeps the Agent's abort error: a patch can't remove a field.
      await ctx.runMutation(components.agent.messages.updateMessage, {
        messageId: message._id,
        patch: { status: "success" },
      });
    }
  }
}

/** Whether the user stopped the reply of the thread's turn at `order`. */
export async function isTurnStopped(
  ctx: QueryCtx,
  threadId: string,
  order: number,
): Promise<boolean> {
  return (await stoppedReply(ctx, threadId, order)) !== null;
}

async function stoppedReply(ctx: QueryCtx, threadId: string, order: number) {
  return await ctx.db
    .query("stoppedReplies")
    .withIndex("by_threadId_and_order", (q) =>
      q.eq("threadId", threadId).eq("order", order),
    )
    .unique();
}

/**
 * The turns among `orders` whose replies were stopped, by order, each with
 * whether its text was kept.
 */
export async function stoppedTurns(
  ctx: QueryCtx,
  threadId: string,
  orders: number[],
): Promise<Map<number, { keepText: boolean }>> {
  if (orders.length === 0) return new Map();
  const first = Math.min(...orders);
  const last = Math.max(...orders);
  // At most one row per turn.
  const rows = await ctx.db
    .query("stoppedReplies")
    .withIndex("by_threadId_and_order", (q) =>
      q.eq("threadId", threadId).gte("order", first).lte("order", last),
    )
    .take(last - first + 1);
  return new Map(rows.map((row) => [row.order, { keepText: row.keepText }]));
}

/**
 * Deletes the thread's stoppedReplies rows, for when the thread goes. One
 * transaction is enough: there's at most one per turn.
 */
export async function deleteStoppedReplies(
  ctx: MutationCtx,
  threadId: string,
): Promise<void> {
  const rows = ctx.db
    .query("stoppedReplies")
    .withIndex("by_threadId_and_order", (q) => q.eq("threadId", threadId));
  for await (const row of rows) {
    await ctx.db.delete("stoppedReplies", row._id);
  }
}
