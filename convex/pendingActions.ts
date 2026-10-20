import { v } from "convex/values";
import { query } from "./_generated/server";
import { findOwnThread, optionalUser } from "./lib/guards";
import { listTemporaryThreadIds } from "./lib/temporaryThreads";

/** The most threads listMine returns. */
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

    const temporary = await listTemporaryThreadIds(ctx, user._id);
    // A row's creation time is its `since`, so the index reads the
    // longest-waiting rows first. The cap counts only threads it returns,
    // so archived ones can't push an active one out.
    const rows = ctx.db
      .query("pendingActions")
      .withIndex("by_userId", (q) => q.eq("userId", user._id));
    const waiting = [];
    for await (const row of rows) {
      if (temporary.has(row.threadId)) continue;
      const thread = await findOwnThread(ctx, user._id, row.threadId);
      if (thread?.status !== "active") continue;
      waiting.push({
        threadId: row.threadId,
        title: thread.title || UNTITLED,
        count: row.count,
        since: row.since,
      });
      if (waiting.length === MAX_PENDING_THREADS) break;
    }
    return waiting;
  },
});
