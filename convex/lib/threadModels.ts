/**
 * The model each thread uses and each user's default model (GLOSSARY.md).
 * A thread's row in threadModels names its model. A thread with no row uses
 * the user's default model, which is DEFAULT_MODEL_ID until the user sets
 * one in userPreferences.
 *
 * The user's plan limits both. A Free user can't pick a Pro model, and a
 * Send whose thread model is off the list or off the user's plan replies
 * on the default model instead (resolveSendModel). The thread then moves to
 * that model, and its row keeps the switch for the composer's note.
 *
 * The functions that check the plan take the user's plan terms
 * (getPlanTerms), null when billing is off. A Send loads them once and
 * passes them to these and to checkSpend.
 */
import { v, type Infer } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { ModelSwitch } from "../schema";
import { getPlanTerms, type PlanTerms } from "./billing";
import { appError, ERROR_CODES } from "./errors";
import {
  defaultModel,
  findModel,
  firstFreeModel,
  modelOrDefault,
  planIncludes,
  type Model,
} from "./models";

/**
 * Why a Send was refused: the user picked a model their plan doesn't
 * include. The Send mutations return it instead of throwing, like a rate
 * limit.
 */
export const vModelLocked = v.object({
  code: v.literal(ERROR_CODES.MODEL_LOCKED),
  message: v.string(),
});

export type ModelLocked = Infer<typeof vModelLocked>;

/** A reply's model, and the model the thread moves off for it, if any. */
export type ReplyModel = { model: Model; switchedFrom: ModelSwitch | null };

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

/**
 * The model the user's new threads start on. That's the default model they
 * set, or DEFAULT_MODEL_ID. When their plan doesn't include it, it's the
 * first Free model.
 */
export async function getDefaultModel(
  ctx: QueryCtx,
  userId: string,
  plan: PlanTerms | null,
): Promise<Model> {
  const preferences = await findUserPreferences(ctx, userId);
  const model = modelOrDefault(preferences?.defaultModelId);
  return planIncludes(plan?.name ?? null, model) ? model : firstFreeModel();
}

/**
 * The model the composer's chip shows for the thread, and the switch its
 * note shows. The model is the one the next reply uses (resolveReplyModel),
 * so a thread on a model the owner's plan no longer includes shows the
 * default model as soon as the plan changes. The switch is the one the next
 * Send makes, or else the one the last Send saved. `userId` is the
 * thread's owner, from its metadata.
 */
export async function getThreadModel(
  ctx: QueryCtx,
  { threadId, userId }: { threadId: string; userId: string | undefined },
): Promise<ReplyModel> {
  const plan = userId ? await getPlanTerms(ctx, userId) : null;
  const next = await resolveReplyModel(ctx, { threadId, userId, plan });
  if (next.switchedFrom) return next;
  const row = await findThreadModel(ctx, threadId);
  return { model: next.model, switchedFrom: row?.switchedFrom ?? null };
}

/**
 * The model the thread's next reply uses. That's the thread's model while
 * it's on the list and the owner's plan includes it. Otherwise it's the
 * owner's default model (getDefaultModel), and `switchedFrom` says which
 * model the thread had and why it can't use it. A thread with no row uses
 * the default model and never switches.
 */
export async function resolveReplyModel(
  ctx: QueryCtx,
  {
    threadId,
    userId,
    plan,
  }: { threadId: string; userId: string | undefined; plan: PlanTerms | null },
): Promise<ReplyModel> {
  if (!userId) return { model: defaultModel(), switchedFrom: null };
  const row = await findThreadModel(ctx, threadId);
  const model = row && findModel(row.modelId);
  if (model && planIncludes(plan?.name ?? null, model)) {
    return { model, switchedFrom: null };
  }
  return {
    model: await getDefaultModel(ctx, userId, plan),
    switchedFrom: row && {
      modelId: row.modelId,
      reason: model ? "plan" : "removed",
    },
  };
}

/**
 * The model of a Send's reply, before the Send saves anything. With
 * `modelId`, the model the composer shows, the user may have picked a new
 * one. A pick has to be on the list and on the user's plan, and a locked
 * one returns ModelLocked. Without a pick, it's the thread's model, or the
 * default model when the thread can't use its model (resolveReplyModel).
 * Pass the result to saveSendModel once the Send goes ahead.
 *
 * The chip can still show a model the thread is moving or just moved off,
 * from before the plan changed or before a queued prompt or a scheduled
 * run moved it. Sending that one counts as no pick.
 */
export async function resolveSendModel(
  ctx: QueryCtx,
  {
    threadId,
    userId,
    plan,
    modelId,
  }: {
    threadId: string;
    userId: string;
    plan: PlanTerms | null;
    modelId?: string;
  },
): Promise<ReplyModel | ModelLocked> {
  const next = await resolveReplyModel(ctx, { threadId, userId, plan });
  if (modelId !== undefined && modelId !== next.model.id) {
    const row = await findThreadModel(ctx, threadId);
    if (modelId !== row?.modelId && modelId !== row?.switchedFrom?.modelId) {
      const model = checkModelPick(plan, modelId);
      if ("code" in model) return model;
      return { model, switchedFrom: null };
    }
  }
  return next;
}

/**
 * Saves the model resolveSendModel returned as the thread's model. A switch
 * saves its reason on the row, for the composer's note. `userSend` is true
 * for a Send the user made (a prompt, a regenerate or an edit). One that
 * doesn't switch clears an older note, so the note shows once. Queued
 * prompts and scheduled runs leave the note.
 */
export async function saveSendModel(
  ctx: MutationCtx,
  {
    threadId,
    model,
    switchedFrom,
    userSend,
  }: ReplyModel & { threadId: string; userSend: boolean },
) {
  const row = await findThreadModel(ctx, threadId);
  if (switchedFrom && row) {
    await ctx.db.patch("threadModels", row._id, {
      modelId: model.id,
      switchedFrom,
    });
  } else if (userSend) {
    await setThreadModelRow(ctx, { threadId, modelId: model.id });
  }
}

/**
 * Moves the thread off a model it can't use (resolveReplyModel), and
 * returns the model of its next reply. For the Sends that pick no model: a
 * regenerate, an edit, a queued prompt and a scheduled run.
 */
export async function settleReplyModel(
  ctx: MutationCtx,
  {
    threadId,
    userId,
    plan,
    userSend,
  }: {
    threadId: string;
    userId: string;
    plan: PlanTerms | null;
    userSend: boolean;
  },
): Promise<Model> {
  const replyModel = await resolveReplyModel(ctx, { threadId, userId, plan });
  await saveSendModel(ctx, { threadId, ...replyModel, userSend });
  return replyModel.model;
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

/**
 * The listed model with this id, or ModelLocked when the user's plan
 * doesn't include it. Throws for an id that's off the list (requireModel).
 * The picker locks the models a plan doesn't include, so only a call that
 * skips it gets ModelLocked.
 */
export function checkModelPick(
  plan: PlanTerms | null,
  modelId: string,
): Model | ModelLocked {
  const model = requireModel(modelId);
  if (planIncludes(plan?.name ?? null, model)) return model;
  return {
    code: ERROR_CODES.MODEL_LOCKED,
    message: `${model.name} is a Pro model. Upgrade to Pro to use it.`,
  };
}

/** checkModelPick, throwing ModelLocked. For the picker's own mutations. */
export function requireModelPick(
  plan: PlanTerms | null,
  modelId: string,
): Model {
  const model = checkModelPick(plan, modelId);
  if ("code" in model) throw appError(model.code, model.message);
  return model;
}

/**
 * Makes `modelId` the thread's model, adding its row if it has none. It
 * also clears the note about an earlier switch.
 */
export async function setThreadModelRow(
  ctx: MutationCtx,
  { threadId, modelId }: { threadId: string; modelId: string },
) {
  const row = await findThreadModel(ctx, threadId);
  if (!row) {
    await ctx.db.insert("threadModels", { threadId, modelId });
  } else if (row.modelId !== modelId || row.switchedFrom) {
    await ctx.db.patch("threadModels", row._id, {
      modelId,
      switchedFrom: undefined,
    });
  }
}

/**
 * Clears the note about the thread's switch (getThreadModel). A switch the
 * next Send would make is made now, so the note doesn't come back.
 */
export async function clearModelSwitch(
  ctx: MutationCtx,
  {
    threadId,
    userId,
    plan,
  }: { threadId: string; userId: string; plan: PlanTerms | null },
) {
  const next = await resolveReplyModel(ctx, { threadId, userId, plan });
  if (next.switchedFrom) {
    await setThreadModelRow(ctx, { threadId, modelId: next.model.id });
    return;
  }
  const row = await findThreadModel(ctx, threadId);
  if (row?.switchedFrom) {
    await ctx.db.patch("threadModels", row._id, { switchedFrom: undefined });
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
