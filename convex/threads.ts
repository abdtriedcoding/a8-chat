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
import { snippetAround } from "./lib/snippet";

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

const MAX_SEARCH_RESULTS = 20;
// A thread can match on many messages, so read more messages than results.
const MAX_MESSAGE_MATCHES = 50;

const vSearchResult = v.object({
  threadId: v.string(),
  title: v.optional(v.string()),
  // From the thread's best-matching message. Missing when only the title
  // matched.
  snippet: v.optional(v.string()),
});

/**
 * The user's threads that match `query` in their title or in a message's
 * text, one result per thread. Title matches come first, then threads that
 * only matched in a message, each group in order of relevance. Empty when
 * signed out.
 */
export const search = query({
  args: { query: v.string() },
  returns: v.array(vSearchResult),
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    const text = args.query.trim();
    if (!user || !text) return [];

    // Always pass a real userId: without one, both searches cover every
    // user's threads.
    const [titleMatches, messageMatches] = await Promise.all([
      ctx.runQuery(components.agent.threads.searchThreadTitles, {
        userId: user._id,
        query: text,
        limit: MAX_SEARCH_RESULTS,
      }),
      ctx.runQuery(components.agent.messages.textSearch, {
        searchAllMessagesForUserId: user._id,
        text,
        limit: MAX_MESSAGE_MATCHES,
      }),
    ]);

    // The first match in each thread is its most relevant one.
    const snippets = new Map<string, string>();
    for (const message of messageMatches) {
      if (message.text && !snippets.has(message.threadId)) {
        snippets.set(message.threadId, snippetAround(message.text, text));
      }
    }

    const results = titleMatches.map((thread) => ({
      threadId: thread._id,
      title: thread.title,
      snippet: snippets.get(thread._id),
    }));
    const seen = new Set(results.map((result) => result.threadId));
    for (const [threadId, snippet] of snippets) {
      if (results.length >= MAX_SEARCH_RESULTS) break;
      if (seen.has(threadId)) continue;
      const thread = await findOwnThread(ctx, user._id, threadId);
      if (thread) results.push({ threadId, title: thread.title, snippet });
    }
    return results;
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
