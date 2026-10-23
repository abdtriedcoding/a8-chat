// The cost recorder (ADR 0015). lib/usage.ts sends model calls, with the
// cost AI Gateway reports, and web searches here. Only the hosted a8
// records costs.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  type ActionCtx,
} from "./_generated/server";
import { authComponent } from "./auth";
import { billingEnabled, getPlan } from "./lib/billing";
import { CREDITS_PER_USD, currentCreditRow } from "./lib/credits";
import {
  addDailySpend,
  addUserDailySpend,
  deleteUserDailySpend,
} from "./lib/dailySpend";
import { gateway } from "./lib/gateway";
import { holdCost, purgeUserHolds, releaseCost } from "./lib/creditHolds";
import { vTokenCounts, vUsageKind } from "./schema";

const PURGE_BATCH_SIZE = 100;

/**
 * How long after a model call to first ask the gateway for its cost, and
 * before the second try. Each try after that waits twice as long as the
 * one before. The gateway took 8 to 10 seconds to report a cost in testing
 * (Oct 21, 2026).
 */
const COST_LOOKUP_DELAY_MS = 5_000;

/**
 * How many times recordGenerationCost asks the gateway for a cost. Six
 * tries span about two and a half minutes.
 */
const COST_LOOKUP_ATTEMPTS = 6;

/** A model call's usage event, before the gateway reports its cost. */
const vModelCall = v.object({
  userId: v.optional(v.string()),
  threadId: v.optional(v.string()),
  kind: vUsageKind,
  model: v.string(),
  tokens: vTokenCounts,
});

/**
 * Schedules recordGenerationCost for a model call, and holds credits for
 * it until the cost is recorded (holdCost). recordModelUsage (lib/usage.ts)
 * calls it from the usage handler, whose ctx can't schedule.
 */
export const scheduleCostLookup = internalMutation({
  args: { generationId: v.string(), event: vModelCall },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, threadId, kind } = args.event;
    // A title's cost doesn't come off the user's credits.
    if (userId && threadId && kind !== "title") {
      await holdCost(ctx, { userId, threadId, generationId: args.generationId });
    }
    await ctx.scheduler.runAfter(
      COST_LOOKUP_DELAY_MS,
      internal.usage.recordGenerationCost,
      args,
    );
    return null;
  },
});

/**
 * Asks AI Gateway what a model call cost and records it (ADR 0015). The
 * gateway can take a while to record a generation, so a lookup that fails
 * tries again, waiting longer each time, up to COST_LOOKUP_ATTEMPTS times. A cost the gateway never
 * reports is logged, not recorded. Either way, the model call's credit hold
 * ends (releaseCost).
 */
export const recordGenerationCost = internalAction({
  args: {
    generationId: v.string(),
    event: vModelCall,
    attempt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { generationId, event, attempt = 1 }): Promise<null> => {
    let costUsd: number;
    try {
      // On a call made with a BYOK key, the gateway charges nothing
      // (totalCost 0) and reports what Anthropic charged the key instead.
      // TEMPORARY: revert to totalCost once spec #334 is done.
      const info = await gateway.getGenerationInfo({ id: generationId });
      costUsd = info.isByok ? info.upstreamInferenceCost : info.totalCost;
    } catch (error) {
      if (attempt >= COST_LOOKUP_ATTEMPTS) {
        console.error(`No cost for generation ${generationId}`, event, error);
        await releaseCostHold(ctx, generationId);
        return null;
      }
      await ctx.scheduler.runAfter(
        COST_LOOKUP_DELAY_MS * 2 ** (attempt - 1),
        internal.usage.recordGenerationCost,
        { generationId, event, attempt: attempt + 1 },
      );
      return null;
    }
    // A failed write is logged, like a failed lookup. Recording the cost
    // ends its hold in the same write.
    await ctx
      .runMutation(internal.usage.record, { ...event, costUsd, generationId })
      .catch(async (error: unknown) => {
        console.error("Couldn't record usage", event, error);
        await releaseCostHold(ctx, generationId);
      });
    return null;
  },
});

/** Ends a model call's credit hold without recording a cost. */
export const releaseCostLookup = internalMutation({
  args: { generationId: v.string() },
  returns: v.null(),
  handler: async (ctx, { generationId }) => {
    await releaseCost(ctx, generationId);
    return null;
  },
});

// A failed release is logged. The hold stops counting after a while.
async function releaseCostHold(ctx: ActionCtx, generationId: string) {
  await ctx
    .runMutation(internal.usage.releaseCostLookup, { generationId })
    .catch((error: unknown) =>
      console.error("Couldn't release the credit hold", generationId, error),
    );
}

/**
 * Records one usage event. It doesn't know where the cost came from. Adds
 * the cost to the day's spend and the user's spend today, and in credits to
 * the user's current period, except for a title, whose cost a8 pays.
 * Records nothing for a user who deleted their account while a reply ran,
 * beyond the day's spend. With `generationId`, it ends that model call's
 * credit hold (releaseCost).
 */
export const record = internalMutation({
  args: {
    userId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    kind: vUsageKind,
    model: v.optional(v.string()),
    tokens: v.optional(vTokenCounts),
    costUsd: v.number(),
    generationId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { generationId, ...event }) => {
    if (!billingEnabled) return null;
    if (generationId) await releaseCost(ctx, generationId);
    const now = Date.now();
    await addDailySpend(ctx, now, event.costUsd);
    const { userId } = event;
    if (!userId) {
      await ctx.db.insert("usageEvents", { ...event, credits: 0 });
      return null;
    }
    if (!(await authComponent.getAnyUserById(ctx, userId))) return null;
    await addUserDailySpend(ctx, userId, now, event.costUsd);
    const credits = event.kind === "title" ? 0 : event.costUsd * CREDITS_PER_USD;
    if (credits > 0) {
      const plan = await getPlan(ctx, userId, now);
      // getPlan returns null only when billing is off.
      if (plan) {
        const row = await currentCreditRow(ctx, userId, plan, now);
        await ctx.db.patch("creditLedger", row._id, {
          creditsUsed: row.creditsUsed + credits,
        });
      }
    }
    await ctx.db.insert("usageEvents", { ...event, credits });
    return null;
  },
});

/**
 * Sets the credits used in the user's current period, opening it if it's
 * new. For seeding a balance from the dashboard, such as to check what the
 * user sees with no credits left.
 */
export const setCreditsUsed = internalMutation({
  args: { userId: v.string(), creditsUsed: v.number() },
  returns: v.null(),
  handler: async (ctx, { userId, creditsUsed }) => {
    const now = Date.now();
    const plan = await getPlan(ctx, userId, now);
    if (!plan) throw new Error("Billing is off.");
    const row = await currentCreditRow(ctx, userId, plan, now);
    await ctx.db.patch("creditLedger", row._id, { creditsUsed });
    return null;
  },
});

/**
 * Deletes a deleted user's ledger rows, usage events, credit holds and
 * daily spend, a batch at a time. Called by purgeAccount.
 */
export const purgeUserUsage = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await deleteUserDailySpend(ctx, userId);
    const rows = await ctx.db
      .query("creditLedger")
      .withIndex("by_userId_and_periodStart", (q) => q.eq("userId", userId))
      .take(PURGE_BATCH_SIZE);
    for (const row of rows) await ctx.db.delete("creditLedger", row._id);
    const events = await ctx.db
      .query("usageEvents")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(PURGE_BATCH_SIZE - rows.length);
    for (const event of events) await ctx.db.delete("usageEvents", event._id);
    const running = await purgeUserHolds(
      ctx,
      userId,
      PURGE_BATCH_SIZE - rows.length - events.length,
    );
    if (rows.length + events.length + running === PURGE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.usage.purgeUserUsage, {
        userId,
      });
    }
    return null;
  },
});
