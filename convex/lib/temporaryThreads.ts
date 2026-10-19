/**
 * A temporary thread is a thread kept out of the user's history
 * (GLOSSARY.md). A row in temporaryThreads marks one. The client deletes
 * the thread when the user leaves it, and deleteIdleTemporaryThreads
 * (convex/temporaryThreads.ts) deletes the ones left idle.
 */
import type { QueryCtx } from "../_generated/server";
import { appError, ERROR_CODES } from "./errors";

/** The thread's temporaryThreads row, or null if it isn't temporary. */
export function findTemporaryThread(ctx: QueryCtx, threadId: string) {
  return ctx.db
    .query("temporaryThreads")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .unique();
}

/** The IDs of the user's temporary threads. A user has a few at most. */
export async function listTemporaryThreadIds(ctx: QueryCtx, userId: string) {
  const ids = new Set<string>();
  const rows = ctx.db
    .query("temporaryThreads")
    .withIndex("by_userId", (q) => q.eq("userId", userId));
  for await (const row of rows) ids.add(row.threadId);
  return ids;
}

/**
 * Throws if the thread is temporary. For the mutations that would keep it
 * or show it to others: rename, pin, archive and share. `action` finishes
 * "You can't … a temporary chat."
 */
export async function refuseTemporaryThread(
  ctx: QueryCtx,
  threadId: string,
  action: string,
) {
  if (await findTemporaryThread(ctx, threadId)) {
    throw appError(
      ERROR_CODES.TEMPORARY_THREAD,
      `You can't ${action} a temporary chat.`,
    );
  }
}
