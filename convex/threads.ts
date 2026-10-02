// See the docs at https://docs.convex.dev/agents/threads
import { getThreadMetadata } from "@convex-dev/agent";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { authComponent, requireUser } from "./auth";

const vThreadSummary = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  title: v.optional(v.string()),
});

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(vThreadSummary),
  handler: async (ctx, { paginationOpts }) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return { page: [], isDone: true, continueCursor: "" };

    // Always pass a real userId: undefined would list the threads with no owner.
    const result = await ctx.runQuery(
      components.agent.threads.listThreadsByUserId,
      { userId: user._id, paginationOpts },
    );
    return {
      ...result,
      page: result.page.map((thread) => ({
        _id: thread._id,
        _creationTime: thread._creationTime,
        title: thread.title,
      })),
    };
  },
});

export const get = query({
  args: { threadId: v.string() },
  returns: v.union(
    v.object({ _id: v.string(), title: v.optional(v.string()) }),
    v.null(),
  ),
  handler: async (ctx, { threadId }) => {
    const thread = await getOwnThread(ctx, threadId);
    return thread ? { _id: thread._id, title: thread.title } : null;
  },
});

/**
 * Deletes a thread. The Agent deletes its messages and streams in batches in
 * the background. This deletes its stoppedReplies rows right away.
 */
export const remove = mutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
      threadId,
    });
    // A thread has at most one row per turn, so one transaction can delete
    // them all.
    const stopped = ctx.db
      .query("stoppedReplies")
      .withIndex("by_threadId_and_order", (q) => q.eq("threadId", threadId));
    for await (const row of stopped) {
      await ctx.db.delete("stoppedReplies", row._id);
    }
    return null;
  },
});

/**
 * The thread, or null when signed out or it isn't the user's. For queries:
 * the session can end under a live query, so they return nothing rather
 * than throw.
 */
export async function getOwnThread(ctx: QueryCtx, threadId: string) {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) return null;
  return findOwnThread(ctx, user._id, threadId);
}

/** Throws unless the signed-in user owns the thread. For mutations. */
export async function authorizeThreadAccess(
  ctx: MutationCtx,
  threadId: string,
): Promise<void> {
  const user = await requireUser(ctx);
  if (!(await findOwnThread(ctx, user._id, threadId))) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Chat not found." });
  }
}

async function findOwnThread(ctx: QueryCtx, userId: string, threadId: string) {
  const thread = await getThreadMetadata(ctx, components.agent, {
    threadId,
  }).catch(() => null);
  return thread?.userId === userId ? thread : null;
}
