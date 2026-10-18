import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { appError, ERROR_CODES } from "../lib/errors";
import { findOwnThread, getOwnThread, requireUser } from "../lib/guards";
import { checkPrompt } from "../lib/prompt";
import { MAX_ATTACHMENTS_PER_PROMPT } from "../lib/attachments";
import { MAX_QUEUED_PROMPTS } from "../lib/queue";

// A thread's queue holds the prompts the user sent while a reply was
// running. sendMessage queues them, and startNextPrompt (convex/chat/send.ts) starts
// them oldest first, each as its own turn. This module holds the queue's
// rows and the functions that manage it. Starting a queued prompt is a Send,
// so it lives with the Sends.

const vQueuedPromptView = v.object({
  _id: v.id("queuedPrompts"),
  _creationTime: v.number(),
  prompt: v.string(),
  attachmentCount: v.number(),
});

export type QueuedPromptView = Infer<typeof vQueuedPromptView>;

/**
 * The thread's queued prompts, oldest first, and whether the queue is
 * paused. The queue stack above the composer shows them. Empty when signed
 * out or the thread isn't the user's.
 */
export const getQueue = query({
  args: { threadId: v.string() },
  returns: v.object({
    prompts: v.array(vQueuedPromptView),
    paused: v.boolean(),
  }),
  handler: async (ctx, { threadId }) => {
    if (!(await getOwnThread(ctx, threadId))) {
      return { prompts: [], paused: false };
    }
    const [prompts, paused] = await Promise.all([
      listQueuedPrompts(ctx, threadId),
      getPausedQueue(ctx, threadId),
    ]);
    return {
      prompts: prompts.map(
        ({ _id, _creationTime, prompt, attachmentFileIds }) => ({
          _id,
          _creationTime,
          prompt,
          attachmentCount: attachmentFileIds.length,
        }),
      ),
      paused: paused !== null,
    };
  },
});

/**
 * Replaces a queued prompt's text. Its attachments stay. Throws if the
 * prompt already started or was deleted.
 */
export const editQueuedPrompt = mutation({
  args: { queuedPromptId: v.id("queuedPrompts"), prompt: v.string() },
  returns: v.null(),
  handler: async (ctx, { queuedPromptId, prompt }) => {
    const queued = await getOwnQueuedPrompt(ctx, queuedPromptId);
    await ctx.db.patch("queuedPrompts", queued._id, {
      prompt: checkPrompt(prompt, queued.attachmentFileIds.length),
    });
    return null;
  },
});

/**
 * Deletes a queued prompt. It doesn't refund the Send. Deleting the last
 * one also unpauses the queue. Throws if the prompt already started or was
 * deleted.
 */
export const deleteQueuedPrompt = mutation({
  args: { queuedPromptId: v.id("queuedPrompts") },
  returns: v.null(),
  handler: async (ctx, { queuedPromptId }) => {
    const queued = await getOwnQueuedPrompt(ctx, queuedPromptId);
    await deleteQueuedPromptRows(ctx, queued);
    if ((await listQueuedPrompts(ctx, queued.threadId)).length === 0) {
      await unpauseThreadQueue(ctx, queued.threadId);
    }
    return null;
  },
});

/**
 * Pauses the thread's queue. streamReply calls this when the reply fails,
 * or starting the next queued prompt does.
 */
export const pauseQueue = internalMutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    await pauseThreadQueue(ctx, threadId);
    return null;
  },
});

/**
 * The queued prompt, if it's in one of the user's threads. Throws NOT_FOUND
 * if it isn't, or it's gone because it started or was deleted.
 */
async function getOwnQueuedPrompt(
  ctx: MutationCtx,
  queuedPromptId: Id<"queuedPrompts">,
) {
  const user = await requireUser(ctx);
  const queued = await ctx.db.get("queuedPrompts", queuedPromptId);
  if (!queued || !(await findOwnThread(ctx, user._id, queued.threadId))) {
    throw appError(
      ERROR_CODES.NOT_FOUND,
      "This prompt already started or was deleted.",
    );
  }
  return queued;
}

/** The thread's queued prompts, oldest first. */
export async function listQueuedPrompts(ctx: QueryCtx, threadId: string) {
  return await ctx.db
    .query("queuedPrompts")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .take(MAX_QUEUED_PROMPTS);
}

/** The thread's pausedQueues row, or null if its queue isn't paused. */
export async function getPausedQueue(ctx: QueryCtx, threadId: string) {
  return await ctx.db
    .query("pausedQueues")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .unique();
}

/**
 * Pauses the thread's queue. Stop and a failed reply call this. Does
 * nothing if the queue is empty, since an empty queue is never paused.
 */
export async function pauseThreadQueue(ctx: MutationCtx, threadId: string) {
  if ((await listQueuedPrompts(ctx, threadId)).length === 0) return;
  if (!(await getPausedQueue(ctx, threadId))) {
    await ctx.db.insert("pausedQueues", { threadId });
  }
}

/** Unpauses the thread's queue. */
export async function unpauseThreadQueue(ctx: MutationCtx, threadId: string) {
  const paused = await getPausedQueue(ctx, threadId);
  if (paused) await ctx.db.delete("pausedQueues", paused._id);
}

/**
 * Adds a prompt to the end of the thread's queue. The caller has checked
 * the prompt, its attachments and the rate limits.
 */
export async function addQueuedPrompt(
  ctx: MutationCtx,
  fields: Omit<Doc<"queuedPrompts">, "_id" | "_creationTime">,
) {
  const queuedPromptId = await ctx.db.insert("queuedPrompts", fields);
  for (const fileId of fields.attachmentFileIds) {
    await ctx.db.insert("queuedPromptFiles", { queuedPromptId, fileId });
  }
}

/**
 * Deletes a queued prompt and its file rows. Its files are then unused
 * again, and cleanUpUnsentUploads deletes them unless something else holds
 * them.
 */
export async function deleteQueuedPromptRows(
  ctx: MutationCtx,
  queued: Doc<"queuedPrompts">,
) {
  const files = await ctx.db
    .query("queuedPromptFiles")
    .withIndex("by_queuedPromptId", (q) => q.eq("queuedPromptId", queued._id))
    .take(MAX_ATTACHMENTS_PER_PROMPT);
  for (const file of files) {
    await ctx.db.delete("queuedPromptFiles", file._id);
  }
  await ctx.db.delete("queuedPrompts", queued._id);
}

/** Deletes the thread's queued prompts and its paused flag. */
export async function deleteThreadQueue(ctx: MutationCtx, threadId: string) {
  for (const queued of await listQueuedPrompts(ctx, threadId)) {
    await deleteQueuedPromptRows(ctx, queued);
  }
  await unpauseThreadQueue(ctx, threadId);
}

/** Whether a queued prompt attaches the file. */
export async function isQueuedFile(ctx: QueryCtx, fileId: string) {
  const file = await ctx.db
    .query("queuedPromptFiles")
    .withIndex("by_fileId", (q) => q.eq("fileId", fileId))
    .first();
  return file !== null;
}
