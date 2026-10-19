import { createThread } from "@convex-dev/agent";
import { pick } from "convex-helpers";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { closeUnrunActions, waitingApprovalIds } from "./chat/approval";
import { getPausedQueue, listQueuedPrompts } from "./chat/queue";
import { isThreadBusy, sendPrompt } from "./chat/send";
import { getLastTurn } from "./chat/turns";
import { appError, ERROR_CODES } from "./lib/errors";
import { optionalUser, requireUser } from "./lib/guards";
import { buildPromptMessage, checkPrompt, checkTitle } from "./lib/prompt";
import { cancelScheduledRun } from "./lib/scheduledPrompts";
import {
  findNextRun,
  scheduleProblem,
  vSchedule,
  type Schedule,
} from "./lib/schedule";
import { resolveTimeZone } from "./lib/timeZone";
import { limitSend } from "./rateLimits";
import { vScheduledPromptStatus } from "./schema";
import { setThreadStatus } from "./threads";

// A scheduled prompt sends itself into its own thread, once or on a
// repeating schedule (GLOSSARY.md, ADR 0013). Each row keeps only its next
// run in the scheduler, and that run schedules the one after it.

const vScheduledPromptView = v.object({
  _id: v.id("scheduledPrompts"),
  _creationTime: v.number(),
  threadId: v.string(),
  title: v.string(),
  prompt: v.string(),
  schedule: vSchedule,
  timeZone: v.string(),
  status: vScheduledPromptStatus,
  nextRunAt: v.optional(v.number()),
});

/** The user's scheduled prompts, newest first. Empty when signed out. */
export const list = query({
  args: {},
  returns: v.array(vScheduledPromptView),
  handler: async (ctx) => {
    const user = await optionalUser(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("scheduledPrompts")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();
    return rows.map((row) =>
      pick(row, [
        "_id",
        "_creationTime",
        "threadId",
        "title",
        "prompt",
        "schedule",
        "timeZone",
        "status",
        "nextRunAt",
      ]),
    );
  },
});

/**
 * Makes a scheduled prompt and its thread, titled with `title`, and
 * schedules its first run. The thread gets no generated title. Throws when
 * signed out, and on a bad title, prompt, schedule or time zone, or a
 * one-off whose time has passed.
 */
export const create = mutation({
  args: {
    title: v.string(),
    prompt: v.string(),
    schedule: vSchedule,
    // The browser's time zone, or the one the user picked.
    timeZone: v.string(),
  },
  returns: v.object({
    scheduledPromptId: v.id("scheduledPrompts"),
    threadId: v.string(),
  }),
  handler: async (ctx, { schedule, timeZone, ...args }) => {
    const user = await requireUser(ctx);
    const title = checkTitle(args.title);
    const prompt = checkPrompt(args.prompt, 0);
    checkSchedule(schedule, timeZone);
    const runAt = findNextRun(schedule, timeZone, Date.now());
    if (runAt === null) {
      throw appError(ERROR_CODES.INVALID_SCHEDULE, "Pick a time in the future.");
    }
    const threadId = await createThread(ctx, components.agent, {
      userId: user._id,
      title,
    });
    const scheduledPromptId = await ctx.db.insert("scheduledPrompts", {
      userId: user._id,
      threadId,
      title,
      prompt,
      schedule,
      timeZone,
      email: false,
      status: "active",
      consecutiveFailures: 0,
      unreadRuns: 0,
    });
    await scheduleRun(ctx, scheduledPromptId, runAt);
    return { scheduledPromptId, threadId };
  },
});

/**
 * One scheduled run. The scheduler fires it at the row's next run time. It
 * schedules the run after this one first, from this run's due time so the
 * schedule doesn't drift, or marks a one-off done. Then it sends the prompt
 * into the thread as a Send, counted against the send limits, in the row's
 * time zone. Like a Send, it moves an archived thread back to the sidebar.
 *
 * Does nothing when the row is gone or isn't active, as when the job fired
 * just as the user paused. Sends nothing while the thread is in use or the
 * send limit refuses.
 */
export const run = internalMutation({
  args: { scheduledPromptId: v.id("scheduledPrompts") },
  returns: v.null(),
  handler: async (ctx, { scheduledPromptId }) => {
    const row = await ctx.db.get("scheduledPrompts", scheduledPromptId);
    if (!row || row.status !== "active") return null;

    await scheduleNextRun(ctx, row);

    const { threadId } = row;
    const [turn, queue, paused] = await Promise.all([
      getLastTurn(ctx, threadId),
      listQueuedPrompts(ctx, threadId),
      getPausedQueue(ctx, threadId),
    ]);
    // Never interrupts a reply or cancels a waiting card.
    if (
      (await isThreadBusy(ctx, threadId, turn)) ||
      waitingApprovalIds(turn).length > 0 ||
      queue.length > 0 ||
      paused !== null
    ) {
      return null;
    }
    if (await limitSend(ctx, row.userId)) return null;
    await setThreadStatus(ctx, threadId, "active");
    // No card is waiting, so this cancels nothing the user hasn't seen. It
    // ends approved actions that never ran, like one in a stopped reply,
    // which Anthropic needs a result for.
    await closeUnrunActions(ctx, threadId, turn);
    await sendPrompt(ctx, {
      threadId,
      message: buildPromptMessage(row.prompt, []),
      attachmentFileIds: [],
      timeZone: row.timeZone,
    });
    return null;
  },
});

/**
 * When a schedule next runs after `from`, in ms since the epoch, for
 * checking the schedule math from the dashboard. Null for a one-off that's
 * past.
 */
export const nextRun = internalQuery({
  args: {
    schedule: vSchedule,
    timeZone: v.string(),
    from: v.number(),
  },
  returns: v.union(
    v.object({
      at: v.number(),
      utc: v.string(),
      // The run's wall-clock time in `timeZone`.
      local: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, { schedule, timeZone, from }) => {
    checkSchedule(schedule, timeZone);
    const at = findNextRun(schedule, timeZone, from);
    if (at === null) return null;
    return {
      at,
      utc: new Date(at).toISOString(),
      local: new Date(at).toLocaleString("en-US", {
        timeZone,
        dateStyle: "full",
        timeStyle: "short",
      }),
    };
  },
});

/** Throws on a malformed schedule or an unknown time zone. */
function checkSchedule(schedule: Schedule, timeZone: string) {
  const problem = scheduleProblem(schedule);
  if (problem) throw appError(ERROR_CODES.INVALID_SCHEDULE, problem);
  if (resolveTimeZone(timeZone) !== timeZone) {
    throw appError(ERROR_CODES.INVALID_SCHEDULE, "Pick a time zone.");
  }
}

/**
 * Schedules the run after the one now running, or marks a one-off done. It
 * counts from the due time, unless that gives a time already past, as after
 * an outage. Then it counts from now, so missed runs don't all fire at once.
 * A recurring run fired by hand before the due time leaves the next run as
 * it is. A one-off fired by hand is done, and its pending run is canceled.
 */
async function scheduleNextRun(
  ctx: MutationCtx,
  row: Doc<"scheduledPrompts">,
) {
  const now = Date.now();
  const early = row.nextRunAt !== undefined && row.nextRunAt > now;
  if (early && row.schedule.kind !== "once") return;
  await cancelScheduledRun(ctx, row);
  let runAt = findNextRun(row.schedule, row.timeZone, row.nextRunAt ?? now);
  if (runAt !== null && runAt <= now) {
    runAt = findNextRun(row.schedule, row.timeZone, now);
  }
  if (runAt === null) {
    await ctx.db.patch("scheduledPrompts", row._id, {
      status: "done",
      nextRunAt: undefined,
      scheduledJobId: undefined,
    });
    return;
  }
  await scheduleRun(ctx, row._id, runAt);
}

async function scheduleRun(
  ctx: MutationCtx,
  scheduledPromptId: Id<"scheduledPrompts">,
  runAt: number,
) {
  const scheduledJobId = await ctx.scheduler.runAt(
    runAt,
    internal.scheduledPrompts.run,
    { scheduledPromptId },
  );
  await ctx.db.patch("scheduledPrompts", scheduledPromptId, {
    nextRunAt: runAt,
    scheduledJobId,
  });
}
