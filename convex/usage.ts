// The cost recorder (ADR 0015). lib/usage.ts prices model calls and web
// searches and sends them here. Only the hosted a8 records costs.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { authComponent } from "./auth";
import { billingEnabled, getPlan } from "./lib/billing";
import { CREDITS_PER_USD, currentCreditRow } from "./lib/credits";
import { addDailySpend } from "./lib/dailySpend";
import { vTokenCounts, vUsageKind } from "./schema";

const PURGE_BATCH_SIZE = 100;

/**
 * Records one usage event. It doesn't know where the cost came from. Adds
 * the cost to the day's spend, and in credits to the user's current period,
 * except for a title, whose cost a8 pays. Records nothing for a user who
 * deleted their account while a reply ran.
 */
export const record = internalMutation({
  args: {
    userId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    kind: vUsageKind,
    model: v.optional(v.string()),
    tokens: v.optional(vTokenCounts),
    costUsd: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, event) => {
    if (!billingEnabled) return null;
    const now = Date.now();
    await addDailySpend(ctx, now, event.costUsd);
    const { userId } = event;
    if (!userId) {
      await ctx.db.insert("usageEvents", { ...event, credits: 0 });
      return null;
    }
    if (!(await authComponent.getAnyUserById(ctx, userId))) return null;
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
 * Deletes a deleted user's ledger rows and usage events, a batch at a time.
 * Called by purgeAccount.
 */
export const purgeUserUsage = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
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
    if (rows.length + events.length === PURGE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.usage.purgeUserUsage, {
        userId,
      });
    }
    return null;
  },
});
