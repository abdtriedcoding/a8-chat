/**
 * The model each thread uses and each user's default model (GLOSSARY.md).
 * A thread's row in threadModels names its model. A thread with no row, or
 * whose model left the list, uses the user's default model, which is
 * DEFAULT_MODEL_ID until the user sets one in userPreferences.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { appError, ERROR_CODES } from "./errors";
import { defaultModel, findModel, modelOrDefault, type Model } from "./models";

/** The thread's threadModels row, or null if it has none. */
export function findThreadModel(ctx: QueryCtx, threadId: string) {
  return ctx.db
    .query("threadModels")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .unique();
}

/** The user's userPreferences row, or null if they've set nothing. */
export function findUserPreferences(ctx: QueryCtx, userId: string) {
  return ctx.db
    .query("userPreferences")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

/** The model the user's new threads start on. */
export async function getDefaultModel(
  ctx: QueryCtx,
  userId: string,
): Promise<Model> {
  const preferences = await findUserPreferences(ctx, userId);
  return modelOrDefault(preferences?.defaultModelId);
}

/**
 * The model the thread's next reply uses. That's the thread's model, or its
 * owner's default model when the thread has none or its model left the
 * list. `userId` is the thread's owner, from its metadata.
 */
export async function getThreadModel(
  ctx: QueryCtx,
  { threadId, userId }: { threadId: string; userId: string | undefined },
): Promise<Model> {
  const row = await findThreadModel(ctx, threadId);
  const model = row && findModel(row.modelId);
  if (model) return model;
  return userId ? await getDefaultModel(ctx, userId) : defaultModel();
}

/**
 * The listed model with this id. Throws for an id that's off the list. The
 * picker offers only listed models, so only a call that skips it gets this.
 */
export function requireModel(modelId: string): Model {
  const model = findModel(modelId);
  if (!model) {
    throw appError(ERROR_CODES.UNKNOWN_MODEL, "That model isn't available.");
  }
  return model;
}

/** Makes `modelId` the thread's model, adding its row if it has none. */
export async function setThreadModelRow(
  ctx: MutationCtx,
  { threadId, userId, modelId }: { threadId: string; userId: string; modelId: string },
) {
  const row = await findThreadModel(ctx, threadId);
  if (!row) {
    await ctx.db.insert("threadModels", { userId, threadId, modelId });
  } else if (row.modelId !== modelId) {
    await ctx.db.patch("threadModels", row._id, { modelId });
  }
}

/** Makes `modelId` the user's default model, adding their row if needed. */
export async function setDefaultModelRow(
  ctx: MutationCtx,
  { userId, modelId }: { userId: string; modelId: string },
) {
  const row = await findUserPreferences(ctx, userId);
  if (row) {
    await ctx.db.patch("userPreferences", row._id, { defaultModelId: modelId });
  } else {
    await ctx.db.insert("userPreferences", { userId, defaultModelId: modelId });
  }
}

/** Deletes the thread's threadModels row. deleteThread calls it. */
export async function deleteThreadModel(ctx: MutationCtx, threadId: string) {
  const row = await findThreadModel(ctx, threadId);
  if (row) await ctx.db.delete("threadModels", row._id);
}
