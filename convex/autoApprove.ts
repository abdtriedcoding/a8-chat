import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  findAutoApproveThread,
  findAutoApproveWarning,
} from "./lib/autoApprove";
import { appError, ERROR_CODES } from "./lib/errors";
import { authorizeThreadAccess, optionalUser, requireUser } from "./lib/guards";
import { findThreadScheduledPrompt } from "./lib/scheduledPrompts";

/**
 * Turns auto-approve on or off for a thread (ADR 0014). Only the user calls
 * it. The model has no tool for it. A reply already running keeps the
 * setting it started with, and cards already waiting still need a
 * decision. Refuses a scheduled prompt thread, whose runs always stop on
 * their cards (ADR 0013).
 */
export const setAutoApprove = mutation({
  args: { threadId: v.string(), on: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { threadId, on }) => {
    await authorizeThreadAccess(ctx, threadId);
    if (await findThreadScheduledPrompt(ctx, threadId)) {
      throw appError(
        ERROR_CODES.SCHEDULED_THREAD,
        "A scheduled task's chat can't auto-approve actions.",
      );
    }
    const row = await findAutoApproveThread(ctx, threadId);
    if (on && !row) {
      await ctx.db.insert("autoApproveThreads", { threadId });
    } else if (!on && row) {
      await ctx.db.delete("autoApproveThreads", row._id);
    }
    return null;
  },
});

/**
 * Whether the user has seen the dialog that explains auto-approve's risk.
 * False when signed out.
 */
export const hasSeenWarning = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const user = await optionalUser(ctx);
    if (!user) return false;
    return (await findAutoApproveWarning(ctx, user._id)) !== null;
  },
});

/** Notes that the user has seen the auto-approve dialog. */
export const markWarningSeen = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if (!(await findAutoApproveWarning(ctx, user._id))) {
      await ctx.db.insert("autoApproveWarnings", { userId: user._id });
    }
    return null;
  },
});

/**
 * Deletes a deleted user's autoApproveWarnings row. Their threads' rows go
 * with the threads (deleteThread). Scheduled by purgeAccount
 * (convex/auth.ts).
 */
export const purgeUserWarning = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const row = await findAutoApproveWarning(ctx, userId);
    if (row) await ctx.db.delete("autoApproveWarnings", row._id);
    return null;
  },
});
