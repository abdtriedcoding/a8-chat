import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import {
  getOwnedThread,
  getViewer,
  requireOwnedThread,
  requireViewer,
} from "./lib/access";
import { chatAgent } from "./lib/agent";
import { deleteStoppedReplies } from "./lib/stop";

const vThreadSummary = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  title: v.optional(v.string()),
});

/** The viewer's threads, newest first. An empty page when signed out. */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(vThreadSummary),
  handler: async (ctx, args) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return { page: [], isDone: true, continueCursor: "" };

    // Always pass a real userId: undefined would list the threads with no owner.
    const result = await ctx.runQuery(
      components.agent.threads.listThreadsByUserId,
      {
        userId: viewer._id,
        order: "desc",
        paginationOpts: args.paginationOpts,
      },
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

/** One of the viewer's threads, or null if it's missing, not theirs, or signed out. */
export const get = query({
  args: { threadId: v.string() },
  returns: v.union(
    v.object({ _id: v.string(), title: v.optional(v.string()) }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return null;
    const thread = await getOwnedThread(ctx, args.threadId, viewer._id);
    if (!thread) return null;
    return { _id: thread._id, title: thread.title };
  },
});

/**
 * Deletes a thread with its messages and streams, in batches in the
 * background. Its stoppedReplies rows go at once.
 */
export const remove = mutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    await requireOwnedThread(ctx, args.threadId, viewer._id);
    await chatAgent.deleteThreadAsync(ctx, { threadId: args.threadId });
    await deleteStoppedReplies(ctx, args.threadId);
    return null;
  },
});
