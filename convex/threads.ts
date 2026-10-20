// See the docs at https://docs.convex.dev/agents/threads
import {
  getThreadMetadata,
  updateThreadMetadata,
  type ThreadDoc,
} from "@convex-dev/agent";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v, type Infer } from "convex/values";
import { components, internal } from "./_generated/api";
import { deleteThreadQueue } from "./chat/queue";
import { deleteThreadSnapshot } from "./sharedSnapshots";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  authorizeThreadAccess,
  findOwnThread,
  getOwnThread,
  optionalUser,
} from "./lib/guards";
import { findAutoApproveThread, isAutoApproveOn } from "./lib/autoApprove";
import { appError, ERROR_CODES } from "./lib/errors";
import {
  deletePendingActions,
  listPendingActionThreadIds,
} from "./lib/pendingActions";
import { checkTitle } from "./lib/prompt";
import {
  deleteThreadScheduledPrompt,
  findThreadScheduledPrompt,
  listUnreadThreadIds,
} from "./lib/scheduledPrompts";
import {
  findTemporaryThread,
  listTemporaryThreadIds,
  refuseTemporaryThread,
} from "./lib/temporaryThreads";
import { snippetAround } from "./lib/threadSearchSnippet";

const vThreadSummary = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  title: v.optional(v.string()),
  // Whether its scheduled prompt has runs the user hasn't opened it to see.
  unread: v.boolean(),
  // Whether an action card waits in its last turn.
  needsApproval: v.boolean(),
});

/** The user's thread IDs that toSummary marks. */
type SummaryMarks = {
  unreadThreadIds: Set<string>;
  pendingThreadIds: Set<string>;
};

function toSummary(
  thread: ThreadDoc,
  { unreadThreadIds, pendingThreadIds }: SummaryMarks,
): Infer<typeof vThreadSummary> {
  return {
    _id: thread._id,
    _creationTime: thread._creationTime,
    title: thread.title,
    unread: unreadThreadIds.has(thread._id),
    needsApproval: pendingThreadIds.has(thread._id),
  };
}

/** The user's thread IDs that toSummary marks, read once per list. */
async function listSummaryMarks(
  ctx: QueryCtx,
  userId: string,
): Promise<SummaryMarks> {
  const [unreadThreadIds, pendingThreadIds] = await Promise.all([
    listUnreadThreadIds(ctx, userId),
    listPendingActionThreadIds(ctx, userId),
  ]);
  return { unreadThreadIds, pendingThreadIds };
}

/** The most Agent thread pages one call to `list` reads. */
const MAX_PAGES_PER_LIST = 10;

/**
 * The user's threads, newest first: the active ones but not the pinned ones,
 * or with `archived`, the archived ones. Never the temporary ones. The
 * Agent's thread list can't filter by status, so this reads its pages until
 * it has `numItems` matches, the
 * list ends, or it has read MAX_PAGES_PER_LIST pages. So a page can come back
 * short, even empty, before the list is done.
 */
export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    archived: v.optional(v.boolean()),
  },
  returns: paginationResultValidator(vThreadSummary),
  handler: async (ctx, { paginationOpts, archived = false }) => {
    const user = await optionalUser(ctx);
    if (!user) return { page: [], isDone: true, continueCursor: "" };

    const status = archived ? "archived" : "active";
    // Archived threads can't be pinned, so only the active list skips pins.
    const pinned = new Set<string>();
    if (!archived) {
      const pins = ctx.db
        .query("threadPins")
        .withIndex("by_userId", (q) => q.eq("userId", user._id));
      for await (const pin of pins) pinned.add(pin.threadId);
    }
    const [temporary, marks] = await Promise.all([
      listTemporaryThreadIds(ctx, user._id),
      listSummaryMarks(ctx, user._id),
    ]);
    const page: Infer<typeof vThreadSummary>[] = [];
    let cursor = paginationOpts.cursor;
    let isDone = false;
    for (let read = 0; read < MAX_PAGES_PER_LIST; read++) {
      // Always pass a real userId: undefined would list the threads with no
      // owner.
      const result = await ctx.runQuery(
        components.agent.threads.listThreadsByUserId,
        { userId: user._id, paginationOpts: { ...paginationOpts, cursor } },
      );
      for (const thread of result.page) {
        if (
          thread.status !== status ||
          pinned.has(thread._id) ||
          temporary.has(thread._id)
        ) {
          continue;
        }
        page.push(toSummary(thread, marks));
      }
      cursor = result.continueCursor;
      isDone = result.isDone;
      // An endCursor pins the page's end, and one read reaches it.
      if (isDone || paginationOpts.endCursor) break;
      if (page.length >= paginationOpts.numItems) break;
    }
    return { page, isDone, continueCursor: cursor ?? "" };
  },
});

/**
 * The user's pinned threads, the most recently pinned first. Not paginated.
 * Empty when signed out.
 */
export const listPinned = query({
  args: {},
  returns: v.array(vThreadSummary),
  handler: async (ctx) => {
    const user = await optionalUser(ctx);
    if (!user) return [];

    const pins = await ctx.db
      .query("threadPins")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();
    const [threads, temporary, marks] = await Promise.all([
      Promise.all(
        pins.map((pin) => findOwnThread(ctx, user._id, pin.threadId)),
      ),
      listTemporaryThreadIds(ctx, user._id),
      listSummaryMarks(ctx, user._id),
    ]);
    // Archiving and deleting unpin, and a temporary thread can't be pinned,
    // so this guard shouldn't skip any.
    return threads.flatMap((thread) =>
      thread?.status === "active" && !temporary.has(thread._id)
        ? [toSummary(thread, marks)]
        : [],
    );
  },
});

export const get = query({
  args: { threadId: v.string() },
  returns: v.union(
    v.object({
      _id: v.string(),
      title: v.optional(v.string()),
      archived: v.boolean(),
      temporary: v.boolean(),
      // The scheduled prompt whose runs go here, or null.
      scheduledPromptId: v.union(v.id("scheduledPrompts"), v.null()),
      // Whether that scheduled prompt has runs the user hasn't seen.
      unread: v.boolean(),
      // Whether the thread has auto-approve on. Always false in a
      // scheduled prompt thread.
      autoApprove: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, { threadId }) => {
    const thread = await getOwnThread(ctx, threadId);
    if (!thread) return null;
    const [temporary, scheduledPrompt, autoApprove] = await Promise.all([
      findTemporaryThread(ctx, threadId),
      findThreadScheduledPrompt(ctx, threadId),
      findAutoApproveThread(ctx, threadId),
    ]);
    return {
      _id: thread._id,
      title: thread.title,
      archived: thread.status === "archived",
      temporary: temporary !== null,
      scheduledPromptId: scheduledPrompt?._id ?? null,
      unread: (scheduledPrompt?.unreadRuns ?? 0) > 0,
      autoApprove: isAutoApproveOn(autoApprove, scheduledPrompt),
    };
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
  // From the thread's best-matching message. Missing when only the title
  // matched.
  snippet: v.optional(v.string()),
});

/**
 * The user's threads that match `query` in their title or in a message's
 * text, one result per thread. Title matches come first, then threads that
 * only matched in a message, each group in order of relevance. Never a
 * temporary thread. Empty when signed out.
 */
export const search = query({
  args: { query: v.string() },
  returns: v.array(vSearchResult),
  handler: async (ctx, args) => {
    const user = await optionalUser(ctx);
    const words = args.query
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .slice(0, MAX_SEARCH_TERMS);
    const terms = words.join(" ");
    if (!user || !terms) return [];

    const [titleMatches, messageMatches, temporary] = await Promise.all([
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
      listTemporaryThreadIds(ctx, user._id),
    ]);

    const snippets = new Map<string, string>();
    for (const message of messageMatches) {
      if (
        message.text &&
        !snippets.has(message.threadId) &&
        !temporary.has(message.threadId)
      ) {
        snippets.set(message.threadId, snippetAround(message.text, words));
      }
    }

    // A temporary thread has no title, so only its messages can match.
    const titled = titleMatches.map((thread) => ({
      threadId: thread._id,
      title: thread.title,
      snippet: snippets.get(thread._id),
    }));
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

export const rename = mutation({
  args: { threadId: v.string(), title: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId, title }) => {
    await authorizeThreadAccess(ctx, threadId);
    await refuseTemporaryThread(ctx, threadId, "rename");
    await updateThreadMetadata(ctx, components.agent, {
      threadId,
      patch: { title: checkTitle(title) },
    });
    return null;
  },
});

/**
 * Archives a thread, or moves it back to the user's chats. An archived
 * thread keeps its messages but leaves the sidebar list. A Send to it moves
 * it back.
 */
export const setArchived = mutation({
  args: { threadId: v.string(), archived: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { threadId, archived }) => {
    await authorizeThreadAccess(ctx, threadId);
    await refuseTemporaryThread(ctx, threadId, "archive");
    await setThreadStatus(ctx, threadId, archived ? "archived" : "active");
    return null;
  },
});

/**
 * Pins a thread to the top of the sidebar, or unpins it. Pinning a pinned
 * thread or unpinning an unpinned one changes nothing. An archived thread
 * isn't in the sidebar, so it can't be pinned. Neither can a temporary one.
 */
export const setPinned = mutation({
  args: { threadId: v.string(), pinned: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { threadId, pinned }) => {
    const user = await authorizeThreadAccess(ctx, threadId);
    await refuseTemporaryThread(ctx, threadId, "pin");
    if (!pinned) {
      await unpinThread(ctx, threadId);
      return null;
    }
    const thread = await getThreadMetadata(ctx, components.agent, {
      threadId,
    });
    if (thread.status === "archived") {
      throw appError(
        ERROR_CODES.THREAD_ARCHIVED,
        "Unarchive this chat to pin it.",
      );
    }
    if (!(await findPin(ctx, threadId))) {
      await ctx.db.insert("threadPins", { userId: user._id, threadId });
    }
    return null;
  },
});

function findPin(ctx: MutationCtx, threadId: string) {
  return ctx.db
    .query("threadPins")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .unique();
}

async function unpinThread(ctx: MutationCtx, threadId: string) {
  const pin = await findPin(ctx, threadId);
  if (pin) await ctx.db.delete("threadPins", pin._id);
}

/**
 * Sets the thread's status. It writes only on a change, so a Send to an
 * active thread doesn't rerun every thread list. Archiving unpins the
 * thread, and moving it back doesn't pin it again.
 */
export async function setThreadStatus(
  ctx: MutationCtx,
  threadId: string,
  status: "active" | "archived",
) {
  if (status === "archived") await unpinThread(ctx, threadId);
  const thread = await getThreadMetadata(ctx, components.agent, { threadId });
  if (thread.status === status) return;
  await updateThreadMetadata(ctx, components.agent, {
    threadId,
    patch: { status },
  });
}

/**
 * Deletes a thread. The Agent deletes its messages and streams in batches in
 * the background. This deletes its stoppedReplies, deferredToolThreads,
 * threadPins, temporaryThreads, autoApproveThreads and pendingActions rows,
 * its queue, its shared snapshot and its scheduled prompt right away, and
 * cancels the scheduled prompt's next run. Its attachments, queued ones included, are
 * left unreferenced, and cleanUpUnsentUploads deletes them.
 */
export const remove = mutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    await deleteThread(ctx, threadId);
    return null;
  },
});

/** Deletes a thread the way remove does, with no access check. */
export async function deleteThread(ctx: MutationCtx, threadId: string) {
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
  await unpinThread(ctx, threadId);
  const temporary = await findTemporaryThread(ctx, threadId);
  if (temporary) await ctx.db.delete("temporaryThreads", temporary._id);
  const autoApprove = await findAutoApproveThread(ctx, threadId);
  if (autoApprove) await ctx.db.delete("autoApproveThreads", autoApprove._id);
  await deletePendingActions(ctx, threadId);
  await deleteThreadQueue(ctx, threadId);
  await deleteThreadSnapshot(ctx, threadId);
  await deleteThreadScheduledPrompt(ctx, threadId);
}

/** How many of a user's threads one account cleanup transaction deletes. */
const PURGE_THREAD_BATCH_SIZE = 25;

/**
 * Deletes a batch of a deleted user's threads the way remove does, then
 * schedules the next batch. It takes the user ID, not the session, since the
 * account is already gone. Scheduled by purgeAccount (convex/auth.ts).
 */
export const purgeUserThreads = internalMutation({
  args: { userId: v.string(), cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { userId, cursor }): Promise<null> => {
    const { page, isDone, continueCursor } = await ctx.runQuery(
      components.agent.threads.listThreadsByUserId,
      {
        userId,
        paginationOpts: {
          numItems: PURGE_THREAD_BATCH_SIZE,
          cursor: cursor ?? null,
        },
      },
    );
    for (const thread of page) {
      await deleteThread(ctx, thread._id);
    }
    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.threads.purgeUserThreads, {
        userId,
        cursor: continueCursor,
      });
    }
    return null;
  },
});
