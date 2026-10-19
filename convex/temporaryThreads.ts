import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { isThreadBusy } from "./chat/send";
import { getLastTurn } from "./chat/turns";
import { deleteThread } from "./threads";

/**
 * How long a temporary thread can go with no new message before
 * deleteIdleTemporaryThreads deletes it.
 */
const TEMPORARY_THREAD_MAX_IDLE_MS = 24 * 60 * 60 * 1000;
/** How many temporaryThreads rows one cleanup transaction reads. */
const CLEANUP_BATCH_SIZE = 10;

/**
 * Deletes temporary threads whose newest message is over a day old, the way
 * remove does (deleteThread). A thread with no messages yet counts from its
 * row's creation time. It skips a thread with a reply still on its way
 * (isThreadBusy). The client deletes a temporary thread when the user leaves
 * it, so this catches the ones whose tab was closed, or whose delete failed.
 *
 * Reads a batch of rows, then schedules the next batch. Runs hourly
 * (convex/crons.ts). To test it by hand, pass a smaller `maxIdleMs`.
 */
export const deleteIdleTemporaryThreads = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    maxIdleMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (
    ctx,
    { cursor, maxIdleMs = TEMPORARY_THREAD_MAX_IDLE_MS },
  ): Promise<null> => {
    const { page, isDone, continueCursor } = await ctx.db
      .query("temporaryThreads")
      .paginate({ numItems: CLEANUP_BATCH_SIZE, cursor: cursor ?? null });
    for (const row of page) {
      const turn = await getLastTurn(ctx, row.threadId);
      const lastActive = turn[0]?._creationTime ?? row._creationTime;
      if (Date.now() - lastActive < maxIdleMs) continue;
      if (await isThreadBusy(ctx, row.threadId, turn)) continue;
      await deleteThread(ctx, row.threadId);
    }
    if (!isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.temporaryThreads.deleteIdleTemporaryThreads,
        { cursor: continueCursor, maxIdleMs },
      );
    }
    return null;
  },
});
