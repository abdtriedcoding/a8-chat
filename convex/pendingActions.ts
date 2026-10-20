import { v } from "convex/values";
import { query } from "./_generated/server";
import { findOwnThread, optionalUser } from "./lib/guards";
import { listTemporaryThreadIds } from "./lib/temporaryThreads";

/** The most threads listMine reads. */
const MAX_PENDING_THREADS = 50;

/** The title for a thread with none, as src/lib/thread-title.ts shows it. */
const UNTITLED = "Untitled chat";

/**
 * The user's threads with action cards waiting in their last turn, the one
 * waiting longest first, with how many cards wait in each. For the sidebar
 * and the alerts. Skips archived, temporary and deleted threads. Empty when
 * signed out.
 */
export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      threadId: v.string(),
      title: v.string(),
      count: v.number(),
      since: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const user = await optionalUser(ctx);
    if (!user) return [];

    // A row's creation time is its `since`, so the index reads the
    // longest-waiting rows first.
    const [rows, temporary] = await Promise.all([
      ctx.db
        .query("pendingActions")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .take(MAX_PENDING_THREADS),
      listTemporaryThreadIds(ctx, user._id),
    ]);
    const threads = await Promise.all(
      rows.map((row) => findOwnThread(ctx, user._id, row.threadId)),
    );
    return rows
      .flatMap((row, index) => {
        const thread = threads[index];
        if (thread?.status !== "active" || temporary.has(row.threadId)) {
          return [];
        }
        return [
          {
            threadId: row.threadId,
            title: thread.title || UNTITLED,
            count: row.count,
            since: row.since,
          },
        ];
      })
      .sort((a, b) => a.since - b.since);
  },
});
