/**
 * Credit holds: replies and model calls whose cost hasn't reached the
 * user's balance yet, for checkSpend (convex/rateLimits.ts). A model call's
 * cost lands 5 to 10 seconds or more after the call (convex/usage.ts), often
 * after its reply has ended. Until then the balance doesn't show it, so
 * each thread with a running reply or a cost on its way holds
 * REPLY_HOLD_CREDITS of the balance. A user with 1 credit left then can't
 * start 10 replies at once, or start the next one before the last one's
 * cost lands.
 *
 * Scheduling a reply holds it (holdReply), and its runner releases it when
 * it ends (releaseReply in convex/chat/reply.ts). Each model call's cost
 * lookup holds it too (holdCost), until the cost is recorded or the lookup
 * gives up (releaseCost). A hold whose release never came stops counting
 * after HOLD_MAX_MS, and countHolds deletes it.
 */
import { MINUTE } from "@convex-dev/rate-limiter";
import type { MutationCtx } from "../_generated/server";
import { billingEnabled } from "./billing";

/**
 * What each thread with a hold holds of the balance, in credits. A typical
 * reply on a Free model costs 5 credits or less (GLOSSARY.md).
 */
export const REPLY_HOLD_CREDITS = 5;

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
 * Holds credits for a reply. Call it where the reply's runner is scheduled.
 * `promptMessageId` is the one the runner gets.
 */
export async function holdReply(
  ctx: MutationCtx,
  hold: { userId: string; threadId: string; promptMessageId: string },
) {
  // Self-hosted a8 has no credits to hold.
  if (!billingEnabled) return;
  await ctx.db.insert("creditHolds", hold);
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
  for (const hold of holds) await ctx.db.delete("creditHolds", hold._id);
}

/** Holds credits for a model call until its cost is recorded. */
export async function holdCost(
  ctx: MutationCtx,
  hold: { userId: string; threadId: string; generationId: string },
) {
  await ctx.db.insert("creditHolds", hold);
}

/** Ends the hold of the model call with `generationId`. */
export async function releaseCost(ctx: MutationCtx, generationId: string) {
  const holds = await ctx.db
    .query("creditHolds")
    .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
    .take(10);
  for (const hold of holds) await ctx.db.delete("creditHolds", hold._id);
}

/**
 * How many of the user's threads hold credits at `now`. A reply and its own
 * model calls count once. Deletes holds whose release never came.
 */
export async function countHolds(
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
  for (const hold of stale) await ctx.db.delete("creditHolds", hold._id);
  const holds = await ctx.db
    .query("creditHolds")
    .withIndex("by_userId", (q) =>
      q.eq("userId", userId).gt("_creationTime", since),
    )
    .take(MAX_COUNTED);
  return new Set(holds.map((hold) => hold.threadId)).size;
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
  for (const hold of holds) await ctx.db.delete("creditHolds", hold._id);
  return holds.length;
}
