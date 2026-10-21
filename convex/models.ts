// The model picker's functions (lib/threadModels.ts). The list itself is
// in lib/models.ts, which the browser reads too.
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { authorizeThreadAccess, optionalUser, requireUser } from "./lib/guards";
import {
  clearModelSwitch,
  findUserPreferences,
  getDefaultModel,
  requireModelPick,
  setDefaultModelRow,
  setThreadModelRow,
} from "./lib/threadModels";

/** The id of the signed-in user's default model. Null when signed out. */
export const defaultModel = query({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const user = await optionalUser(ctx);
    if (!user) return null;
    return (await getDefaultModel(ctx, user._id)).id;
  },
});

/**
 * Sets the model the user's new threads start on. Throws for a model the
 * user's plan doesn't include.
 */
export const setDefaultModel = mutation({
  args: { modelId: v.string() },
  returns: v.null(),
  handler: async (ctx, { modelId }) => {
    const user = await requireUser(ctx);
    await requireModelPick(ctx, user._id, modelId);
    await setDefaultModelRow(ctx, { userId: user._id, modelId });
    return null;
  },
});

/**
 * Sets the model of the thread's next reply, from the picker. A reply
 * already running keeps its model, and a queued prompt uses the new one
 * when it starts. Throws for a model the user's plan doesn't include.
 */
export const setThreadModel = mutation({
  args: { threadId: v.string(), modelId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId, modelId }) => {
    const user = await authorizeThreadAccess(ctx, threadId);
    await requireModelPick(ctx, user._id, modelId);
    await setThreadModelRow(ctx, { threadId, userId: user._id, modelId });
    return null;
  },
});

/** Hides the composer's note about the thread's last model switch. */
export const dismissModelSwitch = mutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    await clearModelSwitch(ctx, threadId);
    return null;
  },
});

/**
 * Deletes a deleted user's userPreferences row. Their threads' rows go with
 * the threads (deleteThread). purgeAccount (convex/auth.ts) calls it.
 */
export const purgeUserPreferences = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const row = await findUserPreferences(ctx, userId);
    if (row) await ctx.db.delete("userPreferences", row._id);
    return null;
  },
});
