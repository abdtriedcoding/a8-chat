/**
 * Helpers for a scheduled prompt's row (GLOSSARY.md). The functions that use
 * them are in convex/scheduledPrompts.ts. deleteThread (convex/threads.ts)
 * deletes a thread's row through here, so it doesn't import that module.
 */
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** The thread's scheduled prompt, or null if it has none. */
export function findThreadScheduledPrompt(ctx: QueryCtx, threadId: string) {
  return ctx.db
    .query("scheduledPrompts")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .unique();
}

/**
 * Cancels the scheduled prompt's next run if it's still pending. A run that
 * already started can't be canceled, and finds the row changed when it reads
 * it.
 */
export async function cancelScheduledRun(
  ctx: MutationCtx,
  row: Doc<"scheduledPrompts">,
) {
  if (!row.scheduledJobId) return;
  const job = await ctx.db.system.get("_scheduled_functions", row.scheduledJobId);
  if (job?.state.kind === "pending") {
    await ctx.scheduler.cancel(row.scheduledJobId);
  }
}

/** Deletes the thread's scheduled prompt, if any, and cancels its next run. */
export async function deleteThreadScheduledPrompt(
  ctx: MutationCtx,
  threadId: string,
) {
  const row = await findThreadScheduledPrompt(ctx, threadId);
  if (!row) return;
  await cancelScheduledRun(ctx, row);
  await ctx.db.delete("scheduledPrompts", row._id);
}
