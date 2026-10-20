/**
 * Helpers for a thread's pendingActions row, which counts the action cards
 * waiting in its last turn (convex/schema.ts). syncPendingActions
 * (convex/chat/approval.ts) recounts them from the thread's messages, and
 * deleteThread (convex/threads.ts) deletes the row through here.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** The thread's pendingActions row, or null if no card waits in it. */
export function findPendingActions(ctx: QueryCtx, threadId: string) {
  return ctx.db
    .query("pendingActions")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .unique();
}

/**
 * Saves how many cards wait in the thread. A count of 0 deletes the row. A
 * row that exists keeps its `since`, and an unchanged count writes nothing,
 * so the thread lists don't rerun.
 */
export async function setPendingActions(
  ctx: MutationCtx,
  {
    userId,
    threadId,
    count,
  }: { userId: string; threadId: string; count: number },
) {
  const row = await findPendingActions(ctx, threadId);
  if (count <= 0) {
    if (row) await ctx.db.delete("pendingActions", row._id);
    return;
  }
  if (!row) {
    await ctx.db.insert("pendingActions", {
      userId,
      threadId,
      count,
      since: Date.now(),
    });
  } else if (row.count !== count) {
    await ctx.db.patch("pendingActions", row._id, { count });
  }
}

/** Deletes the thread's pendingActions row, if any. */
export async function deletePendingActions(ctx: MutationCtx, threadId: string) {
  const row = await findPendingActions(ctx, threadId);
  if (row) await ctx.db.delete("pendingActions", row._id);
}

/**
 * The IDs of the user's threads with a card waiting, archived ones
 * included. Not capped. A user has a row only per thread whose last reply
 * paused on cards.
 */
export async function listPendingActionThreadIds(
  ctx: QueryCtx,
  userId: string,
) {
  const ids = new Set<string>();
  const rows = ctx.db
    .query("pendingActions")
    .withIndex("by_userId", (q) => q.eq("userId", userId));
  for await (const row of rows) ids.add(row.threadId);
  return ids;
}
