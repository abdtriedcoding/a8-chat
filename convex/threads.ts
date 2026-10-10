// See the docs at https://docs.convex.dev/agents/threads
import { getThreadMetadata, updateThreadMetadata } from "@convex-dev/agent";
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
import { checkTitle } from "./lib/prompt";
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
const MAX_MESSAGE_MATCHES = 100;
// Convex search takes up to 16 terms. Its docs don't say what happens past
// that, so the query is cut to 16.
const MAX_SEARCH_TERMS = 16;

const vSearchResult = v.object({
  threadId: v.string(),
  title: v.optional(v.string()),
  // From the thread's best-matching message, or from its first prompt when
  // only the title matched. Missing when that prompt has no text.
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
    // Convex splits a query into terms at spaces and punctuation, so count
    // them the same way.
    const terms = args.query
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .slice(0, MAX_SEARCH_TERMS)
      .join(" ");
    if (!user || !terms) return [];

    // Always pass a real userId. Without one, the title search covers every
    // user's threads.
    const [titleMatches, messageMatches] = await Promise.all([
      ctx.runQuery(components.agent.threads.searchThreadTitles, {
        userId: user._id,
        query: terms,
        limit: MAX_SEARCH_RESULTS,
      }),
      ctx.runQuery(components.agent.messages.textSearch, {
        searchAllMessagesForUserId: user._id,
        text: terms,
        limit: MAX_MESSAGE_MATCHES,
      }),
    ]);

    // The first match in each thread is its most relevant one.
    const snippets = new Map<string, string>();
    for (const message of messageMatches) {
      if (message.text && !snippets.has(message.threadId)) {
        snippets.set(message.threadId, snippetAround(message.text, terms));
      }
    }

    const titled = await Promise.all(
      titleMatches.map(async (thread) => ({
        threadId: thread._id,
        title: thread.title,
        snippet:
          snippets.get(thread._id) ??
          (await firstPromptSnippet(ctx, thread._id, terms)),
      })),
    );
    const titleIds = new Set(titleMatches.map((thread) => thread._id));
    const messageOnly = await Promise.all(
      [...snippets]
        .filter(([threadId]) => !titleIds.has(threadId))
        .slice(0, MAX_SEARCH_RESULTS - titled.length)
        .map(async ([threadId, snippet]) => {
          const thread = await findOwnThread(ctx, user._id, threadId);
          return thread ? { threadId, title: thread.title, snippet } : null;
        }),
    );
    return [...titled, ...messageOnly.filter((result) => result !== null)];
  },
});

/** A snippet of the thread's first prompt, or undefined if it has no text. */
async function firstPromptSnippet(
  ctx: QueryCtx,
  threadId: string,
  terms: string,
) {
  const {
    page: [first],
  } = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
    threadId,
    order: "asc",
    excludeToolMessages: true,
    paginationOpts: { numItems: 1, cursor: null },
  });
  return first?.text ? snippetAround(first.text, terms) : undefined;
}

/**
 * Renames a thread (checkTitle). A generated title that lands later doesn't
 * replace it, since saveTitle only replaces the placeholder.
 */
export const rename = mutation({
  args: { threadId: v.string(), title: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId, title }) => {
    await authorizeThreadAccess(ctx, threadId);
    await updateThreadMetadata(ctx, components.agent, {
      threadId,
      patch: { title: checkTitle(title) },
    });
    return null;
  },
});

/**
 * Deletes a thread. The Agent deletes its messages and streams in batches in
 * the background. This deletes its stoppedReplies and deferredToolThreads
 * rows right away. Its attachments are left unreferenced, and
 * cleanUpUnsentUploads deletes them.
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
    const deferred = await ctx.db
      .query("deferredToolThreads")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .unique();
    if (deferred) await ctx.db.delete("deferredToolThreads", deferred._id);
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

/**
 * Throws unless the signed-in user owns the thread, and returns the user.
 * For mutations.
 */
export async function authorizeThreadAccess(
  ctx: MutationCtx,
  threadId: string,
) {
  const user = await requireUser(ctx);
  if (!(await findOwnThread(ctx, user._id, threadId))) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Chat not found." });
  }
  return user;
}

async function findOwnThread(ctx: QueryCtx, userId: string, threadId: string) {
  const thread = await getThreadMetadata(ctx, components.agent, {
    threadId,
  }).catch(() => null);
  return thread?.userId === userId ? thread : null;
}
