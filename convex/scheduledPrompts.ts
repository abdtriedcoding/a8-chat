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
import { appError, ERROR_CODES, type AppErrorData } from "./lib/errors";
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

/** How many active scheduled prompts a user can have. */
const MAX_ACTIVE_SCHEDULED_PROMPTS = 10;

const vScheduledPromptView = v.object({
  _id: v.id("scheduledPrompts"),
  _creationTime: v.number(),
  threadId: v.string(),
  title: v.string(),
  prompt: v.string(),
  schedule: vSchedule,
  timeZone: v.string(),
  email: v.boolean(),
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
        "email",
        "status",
        "nextRunAt",
      ]),
    );
  },
});

/**
 * Makes a scheduled prompt and its thread, titled with `title`, and
 * schedules its first run. The thread gets no generated title. Throws when
 * signed out, at the active cap, and on a bad title, prompt, schedule or
 * time zone, or a one-off whose time has passed.
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
    const runAt = requireNextRun(schedule, timeZone);
    await refuseAtActiveCap(ctx, user._id);
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
 * Changes a scheduled prompt. Edits apply to future runs only. A new
 * schedule or time zone cancels the pending run and schedules the next one
 * from now. That makes a done one-off active again, which the active cap
 * can refuse. A paused one stays paused, and resume schedules it. Throws on
 * a bad field, or a new time that has passed.
 */
export const update = mutation({
  args: {
    scheduledPromptId: v.id("scheduledPrompts"),
    title: v.string(),
    prompt: v.string(),
    schedule: vSchedule,
    timeZone: v.string(),
    email: v.boolean(),
  },
  returns: v.null(),
  handler: async (
    ctx,
    { scheduledPromptId, schedule, timeZone, email, ...args },
  ) => {
    const { user, row } = await requireOwnScheduledPrompt(
      ctx,
      scheduledPromptId,
    );
    const title = checkTitle(args.title);
    const prompt = checkPrompt(args.prompt, 0);
    checkSchedule(schedule, timeZone);
    await ctx.db.patch("scheduledPrompts", row._id, {
      title,
      prompt,
      schedule,
      timeZone,
      email,
    });
    const timingChanged =
      timeZone !== row.timeZone || !sameSchedule(schedule, row.schedule);
    if (!timingChanged) return null;

    const runAt = requireNextRun(schedule, timeZone);
    if (row.status === "paused") return null;
    if (row.status === "done") await refuseAtActiveCap(ctx, user._id);
    await cancelScheduledRun(ctx, row);
    await ctx.db.patch("scheduledPrompts", row._id, { status: "active" });
    await scheduleRun(ctx, row._id, runAt);
    return null;
  },
});

/** Cancels an active scheduled prompt's next run until resume. */
export const pause = mutation({
  args: { scheduledPromptId: v.id("scheduledPrompts") },
  returns: v.null(),
  handler: async (ctx, { scheduledPromptId }) => {
    const { row } = await requireOwnScheduledPrompt(ctx, scheduledPromptId);
    if (row.status !== "active") return null;
    await cancelScheduledRun(ctx, row);
    await ctx.db.patch("scheduledPrompts", row._id, {
      status: "paused",
      nextRunAt: undefined,
      scheduledJobId: undefined,
    });
    return null;
  },
});

/**
 * Makes a paused scheduled prompt active and schedules its next run from
 * now, with a clean failure count. Throws at the active cap, or for a
 * one-off whose time passed while it was paused.
 */
export const resume = mutation({
  args: { scheduledPromptId: v.id("scheduledPrompts") },
  returns: v.null(),
  handler: async (ctx, { scheduledPromptId }) => {
    const { user, row } = await requireOwnScheduledPrompt(
      ctx,
      scheduledPromptId,
    );
    if (row.status !== "paused") return null;
    await refuseAtActiveCap(ctx, user._id);
    const runAt = requireNextRun(
      row.schedule,
      row.timeZone,
      "Its time has passed. Edit it to pick a new one.",
    );
    await ctx.db.patch("scheduledPrompts", row._id, {
      status: "active",
      consecutiveFailures: 0,
    });
    await scheduleRun(ctx, row._id, runAt);
    return null;
  },
});

/**
 * Deletes a scheduled prompt and cancels its next run. Its thread stays as
 * a regular thread.
 */
export const remove = mutation({
  args: { scheduledPromptId: v.id("scheduledPrompts") },
  returns: v.null(),
  handler: async (ctx, { scheduledPromptId }) => {
    const { row } = await requireOwnScheduledPrompt(ctx, scheduledPromptId);
    await cancelScheduledRun(ctx, row);
    await ctx.db.delete("scheduledPrompts", row._id);
    return null;
  },
});

/**
 * Runs a scheduled prompt now, whatever its status, as a Send. A one-off is
 * then done. A recurring one keeps its next run, or stays paused. Throws
 * when the thread is in use or the send limit refuses, and then changes
 * nothing.
 */
export const runNow = mutation({
  args: { scheduledPromptId: v.id("scheduledPrompts") },
  returns: v.null(),
  handler: async (ctx, { scheduledPromptId }) => {
    const { row } = await requireOwnScheduledPrompt(ctx, scheduledPromptId);
    if (row.status === "active") {
      await scheduleNextRun(ctx, row);
    } else if (row.status === "paused" && row.schedule.kind === "once") {
      await ctx.db.patch("scheduledPrompts", row._id, { status: "done" });
    }
    const refused = await sendRun(ctx, row);
    if (refused) throw appError(refused.code, refused.message);
    return null;
  },
});

/**
 * One scheduled run. The scheduler fires it at the row's next run time. It
 * schedules the run after this one first, from this run's due time so the
 * schedule doesn't drift, or marks a one-off done. Then it sends the prompt
 * (sendRun).
 *
 * Does nothing when the row is gone or isn't active, as when the job fired
 * just as the user paused.
 */
export const run = internalMutation({
  args: { scheduledPromptId: v.id("scheduledPrompts") },
  returns: v.null(),
  handler: async (ctx, { scheduledPromptId }) => {
    const row = await ctx.db.get("scheduledPrompts", scheduledPromptId);
    if (!row || row.status !== "active") return null;
    await scheduleNextRun(ctx, row);
    await sendRun(ctx, row);
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

/**
 * Sends the scheduled prompt into its thread as a Send, counted against the
 * send limits, in the row's time zone. Like a Send, it moves an archived
 * thread back to the sidebar. Returns why it sent nothing: the thread is in
 * use, or the send limit refused.
 */
async function sendRun(
  ctx: MutationCtx,
  row: Doc<"scheduledPrompts">,
): Promise<AppErrorData | null> {
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
    return {
      code: ERROR_CODES.REPLY_IN_PROGRESS,
      message: "Its chat is busy. Open it and finish what's waiting first.",
    };
  }
  const limited = await limitSend(ctx, row.userId);
  if (limited) return limited;
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
}

/**
 * The session user's scheduled prompt. Throws when signed out, and when the
 * row is gone or someone else's.
 */
async function requireOwnScheduledPrompt(
  ctx: MutationCtx,
  scheduledPromptId: Id<"scheduledPrompts">,
) {
  const user = await requireUser(ctx);
  const row = await ctx.db.get("scheduledPrompts", scheduledPromptId);
  if (!row || row.userId !== user._id) {
    throw appError(ERROR_CODES.NOT_FOUND, "Scheduled task not found.");
  }
  return { user, row };
}

/** Throws when the user already has the most active scheduled prompts. */
async function refuseAtActiveCap(ctx: MutationCtx, userId: string) {
  const active = await ctx.db
    .query("scheduledPrompts")
    .withIndex("by_userId_and_status", (q) =>
      q.eq("userId", userId).eq("status", "active"),
    )
    .take(MAX_ACTIVE_SCHEDULED_PROMPTS);
  if (active.length >= MAX_ACTIVE_SCHEDULED_PROMPTS) {
    throw appError(
      ERROR_CODES.TOO_MANY_SCHEDULED_PROMPTS,
      `You can have ${MAX_ACTIVE_SCHEDULED_PROMPTS} active scheduled tasks. Pause or delete one first.`,
    );
  }
}

/**
 * The schedule's next run from now. Throws `message` for a one-off that's
 * past.
 */
function requireNextRun(
  schedule: Schedule,
  timeZone: string,
  message = "Pick a time in the future.",
) {
  const runAt = findNextRun(schedule, timeZone, Date.now());
  if (runAt === null) {
    throw appError(ERROR_CODES.INVALID_SCHEDULE, message);
  }
  return runAt;
}

/** Whether two schedules run at the same wall-clock times. */
function sameSchedule(a: Schedule, b: Schedule) {
  const key = (schedule: Schedule) =>
    JSON.stringify([
      schedule.kind,
      schedule.time,
      schedule.kind === "once" ? schedule.date : null,
      schedule.kind === "weekly" ? [...schedule.days].sort() : null,
      schedule.kind === "monthly" ? schedule.day : null,
    ]);
  return key(a) === key(b);
}

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
