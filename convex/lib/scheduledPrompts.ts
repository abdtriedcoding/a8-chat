/**
 * Helpers for a scheduled prompt's row (GLOSSARY.md). The functions that use
 * them are in convex/scheduledPrompts.ts. deleteThread (convex/threads.ts)
 * deletes a thread's row through here, so it doesn't import that module.
 */
import { v, type Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type WaitingRun = NonNullable<Doc<"scheduledPrompts">["waitingRun"]>;

/**
 * How a reply's runner ended, for its scheduled run (recordRunOutcome in
 * convex/scheduledPrompts.ts). "returned" when the stream ran to its end,
 * which includes an aborted one, "failed" when the runner threw, and
 * "notStarted" when it returned before the model call.
 */
export const vRunEnding = v.union(
  v.literal("returned"),
  v.literal("failed"),
  v.literal("notStarted"),
);

export type RunEnding = Infer<typeof vRunEnding>;

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
  const job = await ctx.db.system.get(
    "_scheduled_functions",
    row.scheduledJobId,
  );
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

/**
 * Points the scheduled prompt's waitingRun at the prompt message its run
 * now has, if it still points at `from`. `from` is the queued prompt that
 * just started, or the prompt a regenerate or an edit replaced. Does
 * nothing when the row is gone, or a later run, like one from Run now, has
 * replaced its waitingRun.
 */
export async function moveWaitingRun(
  ctx: MutationCtx,
  row: Doc<"scheduledPrompts"> | null,
  from: WaitingRun,
  promptMessageId: string,
) {
  const waiting = row?.waitingRun;
  if (!row || !waiting) return;
  const same =
    "queuedPromptId" in from
      ? "queuedPromptId" in waiting &&
        waiting.queuedPromptId === from.queuedPromptId
      : "promptMessageId" in waiting &&
        waiting.promptMessageId === from.promptMessageId;
  if (!same) return;
  await ctx.db.patch("scheduledPrompts", row._id, {
    waitingRun: { promptMessageId },
  });
}
