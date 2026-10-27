import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
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
import { MAX_QUEUED_PROMPTS, QUEUED_EDIT_MS } from "../lib/queue";

// A thread's queue holds the prompts the user sent while a reply was
// running, and scheduled runs that couldn't start right away (sendRun in
// convex/scheduledPrompts.ts). sendMessage queues the user's prompts, and
// startNextPrompt (convex/chat/send.ts) starts them oldest first, each as
// its own turn. This module holds the queue's rows and the functions that
// manage it. Starting a queued prompt is a Send, so it lives with the Sends.
//
// A queued prompt the user is editing doesn't start, so it never runs with
// its old text. Opening the editor calls startQueuedPromptEdit, which keeps
// the prompt back for QUEUED_EDIT_MS, and the queue stack calls it again
// while the editor stays open. Saving, cancelling or deleting ends the edit,
// and the next prompt starts if the thread is free. If the tab closes with
// the editor open, the time runs out and the prompt starts.

const vQueuedPromptView = v.object({
  _id: v.id("queuedPrompts"),
  _creationTime: v.number(),
  // The prompt's row key in the queue stack: its queueKey, or its id.
  key: v.string(),
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
        ({ _id, _creationTime, queueKey, prompt, attachmentFileIds }) => ({
          _id,
          _creationTime,
          key: queueKey ?? _id,
          prompt,
          attachmentCount: attachmentFileIds.length,
        }),
      ),
      paused: paused !== null,
    };
  },
});

/**
 * Keeps a queued prompt from starting for QUEUED_EDIT_MS, while the user
 * edits it. Calling it again starts the time over. Throws if the prompt
 * already started or was deleted.
 */
export const startQueuedPromptEdit = mutation({
  args: { queuedPromptId: v.id("queuedPrompts") },
  returns: v.null(),
  handler: async (ctx, { queuedPromptId }) => {
    const queued = await getOwnQueuedPrompt(ctx, queuedPromptId);
    await ctx.db.patch("queuedPrompts", queued._id, {
      editingUntil: Date.now() + QUEUED_EDIT_MS,
    });
    // Starts the prompt once the time runs out, unless the queue stack calls
    // this again or the edit ends first.
    await scheduleNextPrompt(ctx, queued.threadId, QUEUED_EDIT_MS);
    return null;
  },
});

/**
 * Ends the edit of a queued prompt that the user cancelled, so the prompt
 * can start. Does nothing if no edit is open, or the prompt is gone.
 */
export const cancelQueuedPromptEdit = mutation({
  args: { queuedPromptId: v.id("queuedPrompts") },
  returns: v.null(),
  handler: async (ctx, { queuedPromptId }) => {
    const queued = await findOwnQueuedPrompt(ctx, queuedPromptId);
    if (queued?.editingUntil === undefined) return null;
    await ctx.db.patch("queuedPrompts", queued._id, {
      editingUntil: undefined,
    });
    await startIfWasEditing(ctx, queued);
    return null;
  },
});

/**
 * Replaces a queued prompt's text and ends its edit. Its attachments stay.
 * Throws if the prompt already started or was deleted.
 */
export const editQueuedPrompt = mutation({
  args: { queuedPromptId: v.id("queuedPrompts"), prompt: v.string() },
  returns: v.null(),
  handler: async (ctx, { queuedPromptId, prompt }) => {
    const queued = await getOwnQueuedPrompt(ctx, queuedPromptId);
    await ctx.db.patch("queuedPrompts", queued._id, {
      prompt: checkPrompt(prompt, queued.attachmentFileIds.length),
      editingUntil: undefined,
    });
    await startIfWasEditing(ctx, queued);
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
    await startIfWasEditing(ctx, queued);
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
 * Starts the thread's next prompt if `queued` had an edit open, since the
 * thread may have come free meanwhile. startNextPrompt starts nothing while
 * the thread is busy or its queue is paused.
 */
async function startIfWasEditing(
  ctx: MutationCtx,
  queued: Doc<"queuedPrompts">,
) {
  if (queued.editingUntil !== undefined) {
    await scheduleNextPrompt(ctx, queued.threadId, 0);
  }
}

/** Schedules startNextPrompt for the thread, `delayMs` from now. */
async function scheduleNextPrompt(
  ctx: MutationCtx,
  threadId: string,
  delayMs: number,
) {
  await ctx.scheduler.runAfter(delayMs, internal.chat.send.startNextPrompt, {
    threadId,
  });
}

/**
 * Whether the user is editing the queued prompt: its edit
 * (startQueuedPromptEdit) is open and its time hasn't run out.
 */
export function isBeingEdited(queued: Doc<"queuedPrompts">) {
  return queued.editingUntil !== undefined && queued.editingUntil > Date.now();
}

/**
 * The queued prompt, or null if it isn't in one of the user's threads, or
 * it's gone because it started or was deleted.
 */
async function findOwnQueuedPrompt(
  ctx: MutationCtx,
  queuedPromptId: Id<"queuedPrompts">,
) {
  const user = await requireUser(ctx);
  const queued = await ctx.db.get("queuedPrompts", queuedPromptId);
  if (!queued || !(await findOwnThread(ctx, user._id, queued.threadId))) {
    return null;
  }
  return queued;
}

/**
 * The queued prompt, if it's in one of the user's threads. Throws NOT_FOUND
 * if it isn't, or it's gone because it started or was deleted.
 */
async function getOwnQueuedPrompt(
  ctx: MutationCtx,
  queuedPromptId: Id<"queuedPrompts">,
) {
  const queued = await findOwnQueuedPrompt(ctx, queuedPromptId);
  if (!queued) {
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
 * Adds a prompt to the end of the thread's queue and returns its id. The
 * caller has checked the prompt, its attachments and the rate limits.
 */
export async function addQueuedPrompt(
  ctx: MutationCtx,
  fields: Omit<Doc<"queuedPrompts">, "_id" | "_creationTime">,
) {
  const queuedPromptId = await ctx.db.insert("queuedPrompts", fields);
  for (const fileId of fields.attachmentFileIds) {
    await ctx.db.insert("queuedPromptFiles", { queuedPromptId, fileId });
  }
  return queuedPromptId;
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
