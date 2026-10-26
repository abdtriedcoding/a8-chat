/**
 * Credit holds: replies and model calls whose cost hasn't reached the
 * user's balance yet, for checkSpend (convex/rateLimits.ts). A model call's
 * cost lands 5 to 10 seconds or more after the call (convex/usage.ts), often
 * after its reply has ended. Until then the balance and the day's spend
 * don't show it, so each running reply and each cost on its way holds about
 * what it costs. A user with 1 credit left then can't start 10 replies at
 * once, or start the next one before the last one's cost lands. And a burst
 * of replies on a pricey model can't pass the user's share of the daily
 * spend ceiling, or the ceiling, before their costs land.
 *
 * Scheduling a reply holds what its first model call could cost
 * (holdReply), and its runner releases it when it ends (releaseReply in
 * convex/chat/reply.ts). Each model call's cost lookup holds what its
 * tokens cost at the model's listed prices (holdCost), until the cost is
 * recorded or the lookup gives up (releaseCost). A hold whose release never
 * came stops counting after HOLD_MAX_MS, and userHeldCredits deletes it.
 */
import { listMessages } from "@convex-dev/agent";
import { MINUTE } from "@convex-dev/rate-limiter";
import type { Infer } from "convex/values";
import { components } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { readUserConnections } from "../connections";
import type { vTokenCounts } from "../schema";
import { billingEnabled } from "./billing";
import {
  estimateCredits,
  findModelBySavedId,
  modelOrDefault,
  type Model,
} from "./models";
import { findThreadModel } from "./threadModels";
import {
  estimateSentHistoryTokens,
  historyBudgetTokens,
  TOOL_BUDGET_TOKENS,
} from "./toolLoading";

/**
 * The credits a hold made before a8 sized holds counts as. A model call on
 * a model off the list holds this many too. A typical reply on a Free model
 * costs 5 credits or less (GLOSSARY.md).
 */
const DEFAULT_HOLD_CREDITS = 5;

/**
 * How long a hold counts. Convex stops an action at 10 minutes, and cost
 * lookups give up after about two and a half minutes.
 */
const HOLD_MAX_MS = 15 * MINUTE;

/** At most this many stale holds are deleted per count. */
const STALE_BATCH_SIZE = 20;

/**
 * The most holds a count reads. userSends lets 10 Sends through a minute,
 * and each reply holds once, plus once per model call.
 */
const MAX_COUNTED = 500;

/**
 * About how many tokens a reply sends besides the history and the
 * connector tools: the instructions and a8's own tools.
 */
const REPLY_OVERHEAD_TOKENS = 5_000;

/** The most messages holdReply reads to size the history. */
const MAX_HISTORY_MESSAGES = 100;

/**
 * How many rows each window of heldCredits spreads over, so holds made at
 * once rarely write the same row.
 */
const HELD_CREDITS_SHARDS = 8;

/**
 * Holds what the reply's first model call could cost. Call it where the
 * reply's runner is scheduled, after the prompt is saved. `promptMessageId`
 * is the one the runner gets.
 */
export async function holdReply(
  ctx: MutationCtx,
  hold: { userId: string; threadId: string; promptMessageId: string },
) {
  // Self-hosted a8 has no credits to hold.
  if (!billingEnabled) return;
  const model = modelOrDefault(
    (await findThreadModel(ctx, hold.threadId))?.modelId,
  );
  const inputTokens =
    (await estimateHistoryTokens(ctx, hold.threadId, model)) +
    REPLY_OVERHEAD_TOKENS +
    ((await hasConnectorTools(ctx, hold.userId)) ? TOOL_BUDGET_TOKENS : 0);
  await insertHold(ctx, {
    ...hold,
    credits: estimateCredits(model.usdPerMillionTokens, {
      inputTokens,
      outputTokens: model.maxOutputTokens,
    }),
  });
}

/** Ends the hold of the reply whose runner got `promptMessageId`. */
export async function releaseReply(
  ctx: MutationCtx,
  promptMessageId: string,
) {
  const holds = await ctx.db
    .query("creditHolds")
    .withIndex("by_promptMessageId", (q) =>
      q.eq("promptMessageId", promptMessageId),
    )
    .take(10);
  for (const hold of holds) await deleteHold(ctx, hold);
}

/**
 * Holds what a model call's tokens cost at its model's listed prices, until
 * its cost is recorded. Cached input counts at the full input price.
 * `model` is the gateway id the call reported.
 */
export async function holdCost(
  ctx: MutationCtx,
  {
    model: modelId,
    tokens,
    ...hold
  }: {
    userId: string;
    threadId: string;
    generationId: string;
    model: string;
    tokens: Infer<typeof vTokenCounts>;
  },
) {
  const model = findModelBySavedId(modelId);
  const credits = model
    ? estimateCredits(model.usdPerMillionTokens, {
        inputTokens:
          tokens.inputTokens + tokens.cacheWriteTokens + tokens.cacheReadTokens,
        outputTokens: tokens.outputTokens,
      })
    : DEFAULT_HOLD_CREDITS;
  await insertHold(ctx, { ...hold, credits });
}

/** Ends the hold of the model call with `generationId`. */
export async function releaseCost(ctx: MutationCtx, generationId: string) {
  const holds = await ctx.db
    .query("creditHolds")
    .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
    .take(10);
  for (const hold of holds) await deleteHold(ctx, hold);
}

/**
 * How many credits the user's holds hold at `now`. Deletes holds whose
 * release never came.
 */
export async function userHeldCredits(
  ctx: MutationCtx,
  userId: string,
  now: number,
): Promise<number> {
  const since = now - HOLD_MAX_MS;
  const stale = await ctx.db
    .query("creditHolds")
    .withIndex("by_userId", (q) =>
      q.eq("userId", userId).lte("_creationTime", since),
    )
    .take(STALE_BATCH_SIZE);
  for (const hold of stale) await deleteHold(ctx, hold);
  const holds = await ctx.db
    .query("creditHolds")
    .withIndex("by_userId", (q) =>
      q.eq("userId", userId).gt("_creationTime", since),
    )
    .take(MAX_COUNTED);
  return holds.reduce((sum, hold) => sum + creditsOf(hold), 0);
}

/**
 * How many credits every user's holds hold at `now`, for the daily spend
 * ceiling. It counts the last two windows, so a hold can count for up to
 * twice HOLD_MAX_MS.
 */
export async function totalHeldCredits(
  ctx: QueryCtx,
  now: number,
): Promise<number> {
  const rows = await ctx.db
    .query("heldCredits")
    .withIndex("by_window_and_shard", (q) =>
      q.gte("window", countedSince(now)),
    )
    .take(2 * HELD_CREDITS_SHARDS);
  return rows.reduce((sum, row) => sum + row.credits, 0);
}

/** Deletes up to `limit` of a deleted user's holds. Returns how many. */
export async function purgeUserHolds(
  ctx: MutationCtx,
  userId: string,
  limit: number,
): Promise<number> {
  const holds = await ctx.db
    .query("creditHolds")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(limit);
  for (const hold of holds) await deleteHold(ctx, hold);
  return holds.length;
}

async function insertHold(
  ctx: MutationCtx,
  hold: Omit<Doc<"creditHolds">, "_id" | "_creationTime"> & {
    credits: number;
  },
) {
  const id = await ctx.db.insert("creditHolds", hold);
  // deleteHold takes the credits off the window of the hold's
  // _creationTime, so they go on that window too.
  const saved = await ctx.db.get("creditHolds", id);
  if (saved) await addHeldCredits(ctx, saved._creationTime, hold.credits);
}

/** Every hold ends here, so the heldCredits table stays the holds' sum. */
async function deleteHold(ctx: MutationCtx, hold: Doc<"creditHolds">) {
  await ctx.db.delete("creditHolds", hold._id);
  await addHeldCredits(ctx, hold._creationTime, -creditsOf(hold));
}

function creditsOf(hold: Doc<"creditHolds">): number {
  return hold.credits ?? DEFAULT_HOLD_CREDITS;
}

/**
 * Adds `credits` to the window of a hold made at `madeAt`, in one of its
 * shards. A window too old to count is left alone. A new window's first
 * row deletes rows too old to count.
 */
async function addHeldCredits(
  ctx: MutationCtx,
  madeAt: number,
  credits: number,
) {
  const now = Date.now();
  const window = windowOf(madeAt);
  if (window < countedSince(now)) return;
  const shard = Math.floor(Math.random() * HELD_CREDITS_SHARDS);
  const row = await ctx.db
    .query("heldCredits")
    .withIndex("by_window_and_shard", (q) =>
      q.eq("window", window).eq("shard", shard),
    )
    .unique();
  if (row) {
    await ctx.db.patch("heldCredits", row._id, {
      credits: row.credits + credits,
    });
    return;
  }
  await ctx.db.insert("heldCredits", { window, shard, credits });
  const old = await ctx.db
    .query("heldCredits")
    .withIndex("by_window_and_shard", (q) =>
      q.lt("window", countedSince(now)),
    )
    .take(HELD_CREDITS_SHARDS);
  for (const oldRow of old) await ctx.db.delete("heldCredits", oldRow._id);
}

/** When the window that `at` falls in starts. */
function windowOf(at: number): number {
  return Math.floor(at / HOLD_MAX_MS) * HOLD_MAX_MS;
}

/**
 * The oldest window that still counts at `now`, which is the one before
 * now's.
 */
function countedSince(now: number): number {
  return windowOf(now) - HOLD_MAX_MS;
}

/** About how many tokens of history the thread's next reply sends. */
async function estimateHistoryTokens(
  ctx: MutationCtx,
  threadId: string,
  model: Model,
): Promise<number> {
  const { page } = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { numItems: MAX_HISTORY_MESSAGES, cursor: null },
  });
  return estimateSentHistoryTokens(
    page.flatMap(({ message }) => (message ? [message] : [])).reverse(),
    historyBudgetTokens(model.contextTokens),
  );
}

/** Whether the user's replies offer connector tools. */
async function hasConnectorTools(ctx: QueryCtx, userId: string) {
  const connections = await readUserConnections(ctx, userId);
  return connections.some(({ status }) => status === "connected");
}
