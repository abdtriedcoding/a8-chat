import { createThread, type MessageDoc } from "@convex-dev/agent";
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
  type QueryCtx,
} from "./_generated/server";
import { closeUnrunActions, waitingApprovalIds } from "./chat/approval";
import {
  addQueuedPrompt,
  getPausedQueue,
  listQueuedPrompts,
} from "./chat/queue";
import { isThreadBusy, sendPrompt } from "./chat/send";
import { getStoppedReply } from "./chat/stop";
import { getLastTurn } from "./chat/turns";
import { getPlanTerms } from "./lib/billing";
import { appError, ERROR_CODES, type AppErrorData } from "./lib/errors";
import { optionalUser, requireUser } from "./lib/guards";
import { buildPromptMessage, checkPrompt, checkTitle } from "./lib/prompt";
import { MAX_QUEUED_PROMPTS } from "./lib/queue";
import {
  cancelScheduledRun,
  findThreadScheduledPrompt,
  listUnreadScheduledPrompts,
  vRunEnding,
} from "./lib/scheduledPrompts";
import {
  findNextRun,
  scheduleProblem,
  vSchedule,
  type Schedule,
} from "./lib/schedule";
import type { RunEmailKind } from "./lib/runEmails";
import { resolveTimeZone } from "./lib/timeZone";
import { settleReplyModel } from "./lib/threadModels";
import { limitSend } from "./rateLimits";
import { vLastRun, vScheduledPromptStatus } from "./schema";
import { setThreadStatus } from "./threads";

// A scheduled prompt sends itself into its own thread, once or on a
// repeating schedule (GLOSSARY.md, ADR 0013). Each row keeps only its next
// run in the scheduler, and that run schedules the one after it.

/** How many active scheduled prompts a user can have. */
const MAX_ACTIVE_SCHEDULED_PROMPTS = 10;

/** Failed runs in a row that pause a scheduled prompt. */
const MAX_FAILED_RUNS = 3;

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
  lastRun: v.optional(vLastRun),
  // How many failed runs in a row paused it, when it paused itself rather
  // than the user pausing it.
  pausedAfterFailures: v.optional(v.number()),
});

/** The user's scheduled prompts, newest first. Empty when signed out. */
export const list = query({
  args: {},
  returns: v.array(vScheduledPromptView),
  handler: async (ctx) => {
    const user = await optionalUser(ctx);
    if (!user) return [];
    return await listViews(ctx, user._id);
  },
});

// The model's scheduled prompt tools (convex/tools/scheduledPrompts.ts) call
// the functions below for the reply's user. A reply runs from the scheduler
// with no signed-in user, so they take the user's ID.

/** The user's scheduled prompts, newest first, as `list` returns them. */
export const listForUser = internalQuery({
  args: { userId: v.string() },
  returns: v.array(vScheduledPromptView),
  handler: async (ctx, { userId }) => await listViews(ctx, userId),
});

/**
 * Makes the user's scheduled prompt and its thread (createScheduledPrompt),
 * and returns it as `list` would. Throws wherever createScheduledPrompt
 * throws.
 */
export const createForUser = internalMutation({
  args: {
    userId: v.string(),
    title: v.string(),
    prompt: v.string(),
    schedule: vSchedule,
    timeZone: v.string(),
  },
  returns: vScheduledPromptView,
  handler: async (ctx, { userId, ...fields }) => {
    const { scheduledPromptId } = await createScheduledPrompt(
      ctx,
      userId,
      fields,
    );
    return await getView(ctx, scheduledPromptId);
  },
});

/**
 * Changes the user's scheduled prompt (updateScheduledPrompt), keeping its
 * time zone and email setting, and returns it as `list` would. `title` and
 * `timeZone` are what its action card showed, and `newTitle` renames it.
 * Throws when the row is gone, someone else's or doesn't match them, and
 * wherever updateScheduledPrompt throws.
 */
export const updateForUser = internalMutation({
  args: {
    userId: v.string(),
    // From the model, so it may not be an ID at all.
    scheduledPromptId: v.string(),
    title: v.string(),
    timeZone: v.string(),
    newTitle: v.optional(v.string()),
    prompt: v.string(),
    schedule: vSchedule,
  },
  returns: vScheduledPromptView,
  handler: async (
    ctx,
    { userId, scheduledPromptId, title, timeZone, newTitle, prompt, schedule },
  ) => {
    const row = await findOwnScheduledPrompt(ctx, userId, scheduledPromptId);
    refuseMismatch(
      row,
      checkTitle(title) === row.title && timeZone === row.timeZone,
    );
    await updateScheduledPrompt(ctx, userId, row, {
      title: newTitle ?? row.title,
      prompt,
      schedule,
      timeZone: row.timeZone,
      email: row.email,
    });
    return await getView(ctx, row._id);
  },
});

/**
 * Deletes the user's scheduled prompt (removeScheduledPrompt). The title,
 * prompt and schedule are what its action card showed, so a call where one
 * isn't the row's deletes nothing. Throws then, and when the row is gone or
 * someone else's.
 */
export const removeForUser = internalMutation({
  args: {
    userId: v.string(),
    scheduledPromptId: v.string(),
    title: v.string(),
    prompt: v.string(),
    schedule: vSchedule,
  },
  returns: v.null(),
  handler: async (
    ctx,
    { userId, scheduledPromptId, title, prompt, schedule },
  ) => {
    const row = await findOwnScheduledPrompt(ctx, userId, scheduledPromptId);
    refuseMismatch(
      row,
      checkTitle(title) === row.title &&
        checkPrompt(prompt, 0) === row.prompt &&
        sameSchedule(schedule, row.schedule),
    );
    await removeScheduledPrompt(ctx, row);
    return null;
  },
});

/**
 * How many runs the user hasn't opened the thread to see, across their
 * scheduled prompts. 0 when signed out.
 */
export const unreadCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await optionalUser(ctx);
    if (!user) return 0;
    const rows = await listUnreadScheduledPrompts(ctx, user._id);
    return rows.reduce((count, row) => count + row.unreadRuns, 0);
  },
});

/**
 * Clears the unread runs of the thread's scheduled prompt. The thread page
 * calls it when it opens with unread runs. Does nothing for a thread with no
 * scheduled prompt, or someone else's.
 */
export const markRead = mutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const user = await requireUser(ctx);
    const row = await findThreadScheduledPrompt(ctx, threadId);
    if (row?.userId === user._id && row.unreadRuns > 0) {
      await ctx.db.patch("scheduledPrompts", row._id, { unreadRuns: 0 });
    }
    return null;
  },
});

/**
 * Makes a scheduled prompt and its thread (createScheduledPrompt). Throws
 * when signed out, and wherever createScheduledPrompt throws.
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
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await createScheduledPrompt(ctx, user._id, args);
  },
});

/**
 * Changes a scheduled prompt (updateScheduledPrompt). Throws when signed
 * out, when the row is gone or someone else's, and wherever
 * updateScheduledPrompt throws.
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
  handler: async (ctx, { scheduledPromptId, ...fields }) => {
    const { user, row } = await requireOwnScheduledPrompt(
      ctx,
      scheduledPromptId,
    );
    await updateScheduledPrompt(ctx, user._id, row, fields);
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
    await removeScheduledPrompt(ctx, row);
    return null;
  },
});

/**
 * Runs a scheduled prompt now, whatever its status, as a Send (sendRun). A
 * one-off is then done. A recurring one keeps its next run, or stays
 * paused. It's never skipped, even while the last run waits. Returns
 * whether the prompt was sent or joined the queue. Throws when the
 * thread's queue is full or the send limit refuses, and then changes
 * nothing.
 */
export const runNow = mutation({
  args: { scheduledPromptId: v.id("scheduledPrompts") },
  returns: v.object({
    status: v.union(v.literal("sent"), v.literal("queued")),
  }),
  handler: async (ctx, { scheduledPromptId }) => {
    const { row } = await requireOwnScheduledPrompt(ctx, scheduledPromptId);
    if (row.status === "active") {
      await scheduleNextRun(ctx, row);
    } else if (row.status === "paused" && row.schedule.kind === "once") {
      await ctx.db.patch("scheduledPrompts", row._id, { status: "done" });
    }
    const result = await sendRun(ctx, row);
    if ("code" in result) throw appError(result.code, result.message);
    return result;
  },
});

/**
 * One scheduled run. The scheduler fires it at the row's next run time. It
 * schedules the run after this one first, from this run's due time so the
 * schedule doesn't drift, or marks a one-off done. Then it sends the prompt
 * (sendRun). While the last run hasn't finished (isRunWaiting), it records
 * a skipped run instead, so at most one run waits.
 *
 * When the queue is full or the send limit refuses, the run fails with that
 * reason and sends nothing (recordFailedRun). On the hosted a8 that
 * includes no credits left and the daily spend ceiling (limitSend).
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
    if (await isRunWaiting(ctx, row)) {
      await ctx.db.patch("scheduledPrompts", row._id, {
        lastRun: { at: Date.now(), outcome: "skipped" },
      });
      return null;
    }
    const result = await sendRun(ctx, row);
    if ("code" in result) {
      // scheduleNextRun changed the row's next run.
      const current = await ctx.db.get("scheduledPrompts", row._id);
      if (current) await recordFailedRun(ctx, current, result.message);
    }
    return null;
  },
});

/**
 * Records a failed run for a queued run that checkSpend refused. When
 * checkSpend refuses the queue's next prompt, startNextQueuedPrompt
 * (convex/chat/send.ts) takes the thread's queued run off the queue and
 * calls this. Like a run refused when it ran, it counts toward the failed
 * runs that pause the scheduled prompt.
 */
export const recordRefusedRun = internalMutation({
  args: { scheduledPromptId: v.id("scheduledPrompts"), message: v.string() },
  returns: v.null(),
  handler: async (ctx, { scheduledPromptId, message }) => {
    const row = await ctx.db.get("scheduledPrompts", scheduledPromptId);
    if (row) await recordFailedRun(ctx, row, message);
    return null;
  },
});

/**
 * Records how a reply ended on the thread's scheduled prompt, if the reply
 * answers its waiting run. streamReply calls this when the reply ends.
 *
 * A reply the user stopped is recorded as stopped, and changes the failure
 * count neither way. A finished reply resets the count, and a failed one
 * adds to it (recordFailedRun). A reply can also end on an action card.
 * The run then waits until the reply continues and ends, and that end
 * records the run's outcome again. A reply that never started records
 * nothing, unless the user stopped it. A finished reply adds an unread run,
 * and so does one that ends on a card.
 *
 * A prompt the user sends while the run's cards wait cancels them, and the
 * run's reply never continues. When that prompt's reply ends, the run is
 * recorded as finished.
 *
 * When the row's email is on, a finished reply emails its text, and one that
 * stopped on a card emails what it had and says a card waits. A continuing
 * reply's end sends nothing, since the user is there. The pause after
 * failed runs sends its own email (recordFailedRun).
 */
export const recordRunOutcome = internalMutation({
  args: {
    threadId: v.string(),
    // As streamReply got them.
    promptMessageId: v.string(),
    order: v.number(),
    continuing: v.boolean(),
    ending: vRunEnding,
  },
  returns: v.null(),
  handler: async (
    ctx,
    { threadId, promptMessageId, order, continuing, ending },
  ) => {
    const row = await findThreadScheduledPrompt(ctx, threadId);
    const waiting = row?.waitingRun;
    if (!row || !waiting || !("promptMessageId" in waiting)) return null;
    let answersRun = waiting.promptMessageId === promptMessageId;
    if (continuing) {
      // promptMessageId is the user's decisions on the cards. A regenerate
      // or an edit deletes them with the turn, and the run's new prompt
      // has the same order.
      const [prompt, decisions] = await ctx.runQuery(
        components.agent.messages.getMessagesByIds,
        { messageIds: [waiting.promptMessageId, promptMessageId] },
      );
      answersRun = decisions !== null && prompt?.order === order;
    }
    if (!answersRun) {
      if (
        row.lastRun?.outcome === "actionWaiting" &&
        !(await isRunWaiting(ctx, row))
      ) {
        await ctx.db.patch("scheduledPrompts", row._id, {
          lastRun: { at: row.lastRun.at, outcome: "finished" },
          consecutiveFailures: 0,
        });
      }
      return null;
    }

    const at = Date.now();
    if (await getStoppedReply(ctx, threadId, order)) {
      await ctx.db.patch("scheduledPrompts", row._id, {
        lastRun: { at, outcome: "stopped" },
      });
      return null;
    }
    if (ending === "notStarted") return null;
    const turn = await getLastTurn(ctx, threadId);
    const latest = turn[0]?.order === order ? turn[0] : undefined;
    if (ending === "failed" || latest?.status === "failed") {
      await recordFailedRun(ctx, row);
      return null;
    }
    // A continuing reply ends after the user decided the cards, so they've
    // seen it.
    const unreadRuns = continuing ? row.unreadRuns : row.unreadRuns + 1;
    if (latest && waitingApprovalIds(turn).length > 0) {
      await ctx.db.patch("scheduledPrompts", row._id, {
        lastRun: { at, outcome: "actionWaiting" },
        unreadRuns,
      });
      if (!continuing) await emailRun(ctx, row, "actionWaiting", turn);
    } else {
      await ctx.db.patch("scheduledPrompts", row._id, {
        lastRun: { at, outcome: "finished" },
        consecutiveFailures: 0,
        unreadRuns,
      });
      if (!continuing && latest) await emailRun(ctx, row, "reply", turn);
    }
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
 * send limits, in the row's time zone, and stores it as the waiting run.
 * It never interrupts a reply or cancels a card. While a reply is running
 * or a card waits, the prompt joins the queue instead. It also joins when
 * the queue has prompts or is paused. Like a Send, it moves an archived
 * thread back to the sidebar. When the thread can't use its model
 * anymore, the run replies on the user's default model, and the thread
 * moves to it (settleReplyModel). Returns whether it sent or queued the
 * prompt, or why it sent nothing: the queue is full, or the send limit
 * refused.
 */
async function sendRun(
  ctx: MutationCtx,
  row: Doc<"scheduledPrompts">,
): Promise<{ status: "sent" | "queued" } | AppErrorData> {
  const { threadId } = row;
  const [turn, queue, paused] = await Promise.all([
    getLastTurn(ctx, threadId),
    listQueuedPrompts(ctx, threadId),
    getPausedQueue(ctx, threadId),
  ]);
  const shouldQueue =
    (await isThreadBusy(ctx, threadId, turn)) ||
    waitingApprovalIds(turn).length > 0 ||
    queue.length > 0 ||
    paused !== null;
  if (shouldQueue && queue.length >= MAX_QUEUED_PROMPTS) {
    return {
      code: ERROR_CODES.QUEUE_FULL,
      message: `Its chat already has ${MAX_QUEUED_PROMPTS} queued prompts. Open it and wait for one to start.`,
    };
  }
  const plan = await getPlanTerms(ctx, row.userId);
  const limited = await limitSend(ctx, row.userId, plan);
  if (limited) return limited;
  await setThreadStatus(ctx, threadId, "active");
  if (shouldQueue) {
    const queuedPromptId = await addQueuedPrompt(ctx, {
      threadId,
      userId: row.userId,
      prompt: row.prompt,
      attachmentFileIds: [],
      timeZone: row.timeZone,
      scheduledPromptId: row._id,
    });
    await ctx.db.patch("scheduledPrompts", row._id, {
      waitingRun: { queuedPromptId },
    });
    return { status: "queued" };
  }
  // No card is waiting, so this cancels nothing the user hasn't seen. It
  // ends approved actions that never ran, like one in a stopped reply,
  // which Anthropic needs a result for.
  await closeUnrunActions(ctx, threadId, turn);
  await settleReplyModel(ctx, {
    threadId,
    userId: row.userId,
    plan,
    userSend: false,
  });
  const promptMessageId = await sendPrompt(ctx, {
    userId: row.userId,
    threadId,
    message: buildPromptMessage(row.prompt, []),
    attachmentFileIds: [],
    timeZone: row.timeZone,
  });
  await ctx.db.patch("scheduledPrompts", row._id, {
    waitingRun: { promptMessageId },
  });
  return { status: "sent" };
}

/**
 * Whether the scheduled prompt's last run hasn't finished. That's while its
 * queued prompt is still in the queue, or its prompt is in the thread's
 * last turn and that turn's reply is running or has a card waiting. A run
 * whose turn isn't the last one anymore has finished. A later prompt starts
 * only once the user has decided its cards, or sent a prompt that cancelled
 * them. A regenerate or an edit replaces the run's prompt, and moves
 * waitingRun to the new one.
 */
async function isRunWaiting(ctx: MutationCtx, row: Doc<"scheduledPrompts">) {
  const { waitingRun, threadId } = row;
  if (!waitingRun) return false;
  if ("queuedPromptId" in waitingRun) {
    return (
      (await ctx.db.get("queuedPrompts", waitingRun.queuedPromptId)) !== null
    );
  }
  const turn = await getLastTurn(ctx, threadId);
  if (!turn.some((message) => message._id === waitingRun.promptMessageId)) {
    return false;
  }
  return (
    (await isThreadBusy(ctx, threadId, turn)) ||
    waitingApprovalIds(turn).length > 0
  );
}

/**
 * Records a failed run, with `message` saying why if it sent nothing. An
 * active scheduled prompt adds it to the failure count, and at
 * MAX_FAILED_RUNS in a row pauses itself and cancels its next run. A
 * paused or done one, run with Run now, keeps its count, so the page can
 * tell a scheduled prompt that paused itself from one the user paused.
 * Resume clears the count.
 */
async function recordFailedRun(
  ctx: MutationCtx,
  row: Doc<"scheduledPrompts">,
  message?: string,
) {
  const lastRun = { at: Date.now(), outcome: "failed" as const, message };
  if (row.status !== "active") {
    await ctx.db.patch("scheduledPrompts", row._id, { lastRun });
    return;
  }
  const consecutiveFailures = row.consecutiveFailures + 1;
  if (consecutiveFailures < MAX_FAILED_RUNS) {
    await ctx.db.patch("scheduledPrompts", row._id, {
      consecutiveFailures,
      lastRun,
    });
    return;
  }
  await cancelScheduledRun(ctx, row);
  await ctx.db.patch("scheduledPrompts", row._id, {
    consecutiveFailures,
    lastRun,
    status: "paused",
    nextRunAt: undefined,
    scheduledJobId: undefined,
  });
  await emailRun(ctx, row, "paused", [], consecutiveFailures);
}

/**
 * Emails the user about a run, if the row's email is on. The email holds the
 * reply text of `turn`, the run's turn with the newest message first.
 */
async function emailRun(
  ctx: MutationCtx,
  row: Doc<"scheduledPrompts">,
  kind: RunEmailKind,
  turn: MessageDoc[],
  failures = 0,
) {
  if (!row.email) return;
  // Like replyText in the client, a reply's steps get a blank line between.
  const reply = turn
    .filter((message) => message.message?.role === "assistant" && message.text)
    .map((message) => message.text)
    .reverse()
    .join("\n\n");
  // Scheduled, so a failure to queue the email can't undo the outcome.
  await ctx.scheduler.runAfter(0, internal.emails.sendRunEmail, {
    kind,
    userId: row.userId,
    threadId: row.threadId,
    title: row.title,
    reply,
    failures,
  });
}

/** The user's scheduled prompts, newest first, as `list` returns them. */
async function listViews(ctx: QueryCtx, userId: string) {
  const rows = await ctx.db
    .query("scheduledPrompts")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .order("desc")
    .collect();
  return rows.map(toView);
}

/** A scheduled prompt as `list` returns it. Throws when it's gone. */
async function getView(
  ctx: QueryCtx,
  scheduledPromptId: Id<"scheduledPrompts">,
) {
  const row = await ctx.db.get("scheduledPrompts", scheduledPromptId);
  if (!row) throw new Error("The scheduled prompt is gone.");
  return toView(row);
}

function toView(row: Doc<"scheduledPrompts">) {
  return {
    ...pick(row, [
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
      "lastRun",
    ]),
    pausedAfterFailures:
      row.status === "paused" && row.consecutiveFailures >= MAX_FAILED_RUNS
        ? row.consecutiveFailures
        : undefined,
  };
}

/**
 * Makes the user's scheduled prompt and its thread, titled with `title`,
 * and schedules its first run. The thread gets no generated title. Throws
 * at the active cap, and on a bad title, prompt, schedule or time zone, or
 * a one-off whose time has passed.
 */
async function createScheduledPrompt(
  ctx: MutationCtx,
  userId: string,
  {
    schedule,
    timeZone,
    ...fields
  }: { title: string; prompt: string; schedule: Schedule; timeZone: string },
) {
  const title = checkTitle(fields.title);
  const prompt = checkPrompt(fields.prompt, 0);
  checkSchedule(schedule, timeZone);
  const runAt = requireNextRun(schedule, timeZone);
  await refuseAtActiveCap(ctx, userId);
  const threadId = await createThread(ctx, components.agent, {
    userId,
    title,
  });
  const scheduledPromptId = await ctx.db.insert("scheduledPrompts", {
    userId,
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
}

/**
 * Changes the user's scheduled prompt. Edits apply to future runs only. A
 * new schedule or time zone cancels the pending run and schedules the next
 * one from now. That makes a done one-off active again, which the active
 * cap can refuse. A paused one stays paused, and resume schedules it.
 * Throws on a bad field, or a new time that has passed.
 */
async function updateScheduledPrompt(
  ctx: MutationCtx,
  userId: string,
  row: Doc<"scheduledPrompts">,
  {
    schedule,
    timeZone,
    email,
    ...fields
  }: {
    title: string;
    prompt: string;
    schedule: Schedule;
    timeZone: string;
    email: boolean;
  },
) {
  const title = checkTitle(fields.title);
  const prompt = checkPrompt(fields.prompt, 0);
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
  if (!timingChanged) return;

  const runAt = requireNextRun(schedule, timeZone);
  if (row.status === "paused") return;
  if (row.status === "done") await refuseAtActiveCap(ctx, userId);
  await cancelScheduledRun(ctx, row);
  await ctx.db.patch("scheduledPrompts", row._id, { status: "active" });
  await scheduleRun(ctx, row._id, runAt);
}

/**
 * Deletes a scheduled prompt and cancels its next run. Its thread stays as
 * a regular thread.
 */
async function removeScheduledPrompt(
  ctx: MutationCtx,
  row: Doc<"scheduledPrompts">,
) {
  await cancelScheduledRun(ctx, row);
  await ctx.db.delete("scheduledPrompts", row._id);
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
  const row = await findOwnScheduledPrompt(ctx, user._id, scheduledPromptId);
  return { user, row };
}

/**
 * Throws unless `matches`, which says the row is the one the model's action
 * card showed, so a card can't name one scheduled prompt and change another.
 */
function refuseMismatch(row: Doc<"scheduledPrompts">, matches: boolean) {
  if (matches) return;
  throw appError(
    ERROR_CODES.NOT_FOUND,
    `That doesn't match the scheduled task "${row.title}". List them again and copy it exactly.`,
  );
}

/**
 * The user's scheduled prompt by its ID. Throws when the ID isn't one, and
 * when the row is gone or someone else's.
 */
async function findOwnScheduledPrompt(
  ctx: MutationCtx,
  userId: string,
  scheduledPromptId: string,
) {
  const id = ctx.db.normalizeId("scheduledPrompts", scheduledPromptId);
  const row = id && (await ctx.db.get("scheduledPrompts", id));
  if (!row || row.userId !== userId) {
    throw appError(ERROR_CODES.NOT_FOUND, "Scheduled task not found.");
  }
  return row;
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
async function scheduleNextRun(ctx: MutationCtx, row: Doc<"scheduledPrompts">) {
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
