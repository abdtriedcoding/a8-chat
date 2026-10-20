// The model's tools for the user's scheduled prompts (GLOSSARY.md). They
// call the same functions as the Scheduled page, for the reply's user and
// in the reply's time zone. Creating, changing and deleting are actions, so
// each waits on a card (ADR 0013). connectorView.ts says how a reply shows
// them. See https://docs.convex.dev/agents/tools
import { createTool, type ToolCtx } from "@convex-dev/agent";
import type { ToolApprovalStatus, ToolSet } from "ai";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import { A8_TOOLS, type A8ToolName } from "../lib/connectorView";
import { describeSchedule } from "../lib/scheduleText";

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .describe('24-hour "HH:MM".');

// Matches vSchedule (convex/lib/schedule.ts).
const schedule = z
  .union([
    z.object({
      kind: z.literal("once"),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe('"YYYY-MM-DD".'),
      time,
    }),
    z.object({ kind: z.literal("daily"), time }),
    z
      .object({ kind: z.literal("weekdays"), time })
      .describe("Monday to Friday."),
    z.object({
      kind: z.literal("weekly"),
      days: z
        .array(z.number().int().min(0).max(6))
        .min(1)
        .describe("Days of the week. 0 is Sunday."),
      time,
    }),
    z.object({
      kind: z.literal("monthly"),
      day: z
        .number()
        .int()
        .min(1)
        .max(31)
        .describe(
          "Day of the month. Past the end of a shorter month, it runs on the last day.",
        ),
      time,
    }),
  ])
  .describe("When it runs, as wall-clock times.");

const title = z
  .string()
  .describe("A short title the user will know it by, like \"Morning email\".");

const prompt = z
  .string()
  .describe(
    "The prompt a8 sends at each run, written as the user's own request.",
  );

const scheduledPromptId = z
  .string()
  .describe("The scheduled task's id, from listScheduledPrompts.");

/** For a tool that names an existing scheduled prompt by its title. */
const currentTitle = z
  .string()
  .describe(
    "The scheduled task's title, exactly as listScheduledPrompts gave it.",
  );

type ScheduledPromptView = FunctionReturnType<
  typeof internal.scheduledPrompts.listForUser
>[number];

/**
 * The tools and their `toolApproval` entries for a reply. A temporary
 * thread gets none, since a scheduled prompt can't be made from one.
 *
 * @param timeZone The reply's time zone, already checked by
 *   resolveTimeZone. A new scheduled prompt's times are in it. A changed
 *   one keeps its own.
 */
export function createScheduledPromptTools(timeZone: string): {
  tools: Record<A8ToolName, ToolSet[string]>;
  toolApproval: Record<string, ToolApprovalStatus>;
} {
  const describe = (view: ScheduledPromptView) =>
    describeForModel(view, timeZone);
  return {
    tools: {
      listScheduledPrompts: createTool({
        description:
          "List the user's scheduled tasks, newest first, with each one's id, title, prompt, schedule, status and next run.",
        inputSchema: z.object({}),
        execute: async (ctx) => {
          const views = await ctx.runQuery(
            internal.scheduledPrompts.listForUser,
            { userId: requireUserId(ctx) },
          );
          return views.map(describe);
        },
      }),
      createScheduledPrompt: createTool({
        description:
          "Schedule a prompt for a8 to send itself later, once or on a repeating schedule, in the user's time zone. Each scheduled task gets a chat of its own, and every run replies there.",
        inputSchema: z.object({ title, prompt, schedule }),
        execute: async (ctx, input) =>
          describe(
            await withAppMessage(() =>
              ctx.runMutation(internal.scheduledPrompts.createForUser, {
                userId: requireUserId(ctx),
                ...input,
                timeZone,
              }),
            ),
          ),
      }),
      updateScheduledPrompt: createTool({
        description:
          "Change a scheduled task. Pass its prompt and schedule as they should be after the change, with the parts that don't change copied from listScheduledPrompts. The schedule stays in the task's own time zone.",
        inputSchema: z.object({
          scheduledPromptId,
          title: currentTitle,
          newTitle: title.optional().describe("A new title, to rename it."),
          prompt,
          schedule,
        }),
        execute: async (ctx, input) =>
          describe(
            await withAppMessage(() =>
              ctx.runMutation(internal.scheduledPrompts.updateForUser, {
                userId: requireUserId(ctx),
                ...input,
              }),
            ),
          ),
      }),
      deleteScheduledPrompt: createTool({
        description:
          "Delete a scheduled task. Its chat stays as a regular chat.",
        // The prompt and schedule are for its action card. Like the title,
        // they must be the row's.
        inputSchema: z.object({
          scheduledPromptId,
          title: currentTitle,
          prompt: prompt.describe(
            "Its prompt, exactly as listScheduledPrompts gave it.",
          ),
          schedule: schedule.describe(
            "Its schedule, exactly as listScheduledPrompts gave it.",
          ),
        }),
        execute: async (ctx, input) => {
          await withAppMessage(() =>
            ctx.runMutation(internal.scheduledPrompts.removeForUser, {
              userId: requireUserId(ctx),
              ...input,
            }),
          );
          return "Deleted.";
        },
      }),
    },
    toolApproval: Object.fromEntries(
      Object.entries(A8_TOOLS).flatMap(([name, tool]) =>
        tool.kind === "action" ? [[name, "user-approval" as const]] : [],
      ),
    ),
  };
}

/** A scheduled prompt as the model sees it, with its times in words. */
function describeForModel(view: ScheduledPromptView, timeZone: string) {
  return {
    id: view._id,
    title: view.title,
    prompt: view.prompt,
    schedule: view.schedule,
    scheduleInWords: describeSchedule(view.schedule),
    // Its times follow its own time zone, which can differ from the user's
    // current one.
    timeZone: view.timeZone,
    status: view.status,
    ...(view.nextRunAt !== undefined && {
      nextRun: new Date(view.nextRunAt).toLocaleString("en-US", {
        timeZone,
        dateStyle: "full",
        timeStyle: "short",
      }),
    }),
  };
}

/** The reply's user. The Agent reads it from the thread. */
function requireUserId(ctx: ToolCtx): string {
  if (!ctx.userId) throw new Error("This chat has no user.");
  return ctx.userId;
}

/**
 * Runs `call`, and turns an app error into a plain one with only its
 * message, which the model reads as the tool's error and the user can be
 * told, like the active cap's "You can have 10 active scheduled tasks."
 */
async function withAppMessage<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (
      error instanceof ConvexError &&
      typeof error.data === "object" &&
      error.data !== null &&
      "message" in error.data &&
      typeof error.data.message === "string"
    ) {
      throw new Error(error.data.message);
    }
    throw error;
  }
}
