/**
 * The credit ledger: one creditLedger row per user per credit period. A
 * credit is one US cent of model cost (GLOSSARY.md). Rows open lazily, on
 * the first usage in a period, and resolveCreditPeriod decides which row
 * covers now.
 */
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { getPlan, MONTHLY_CREDITS, type Plan } from "./billing";
import { creditPeriodAt, resolveCreditPeriod } from "./creditPeriod";
import { emailKey } from "./emailKey";
import { monthlyPeriod } from "./monthlyPeriod";

/** USD to credits. One credit is one US cent. */
export const CREDITS_PER_USD = 100;

/** The user's newest ledger row, or null before their first usage. */
export async function latestCreditRow(
  ctx: QueryCtx,
  userId: string,
): Promise<Doc<"creditLedger"> | null> {
  return await ctx.db
    .query("creditLedger")
    .withIndex("by_userId_and_periodStart", (q) => q.eq("userId", userId))
    .order("desc")
    .first();
}

/**
 * The user's ledger row at `now`, opening it when the period is new or the
 * user upgraded. An upgrade ends the row before it (resolveCreditPeriod).
 */
export async function currentCreditRow(
  ctx: MutationCtx,
  userId: string,
  plan: Plan,
  now: number,
): Promise<Doc<"creditLedger">> {
  const latest = await latestCreditRow(ctx, userId);
  const resolved = resolveCreditPeriod(latest, plan, now);
  if ("keeps" in resolved) return resolved.keeps;
  if (latest && resolved.closesLatestAt !== null) {
    await ctx.db.patch("creditLedger", latest._id, {
      periodEnd: resolved.closesLatestAt,
    });
  }
  const row = { userId, ...resolved.opens };
  const id = await ctx.db.insert("creditLedger", row);
  return { _id: id, _creationTime: now, ...row };
}

/** The credits kept for a deleted account with this email key, if any. */
export async function findDeletedUsage(ctx: QueryCtx, key: string) {
  return await ctx.db
    .query("deletedUsage")
    .withIndex("by_emailKey", (q) => q.eq("emailKey", key))
    .unique();
}

/**
 * Keeps the credits a user used in their current period under the key of
 * their email (deletedUsage in schema.ts), for an account about to be
 * deleted. It keeps a row even with no credits used yet, so a reply's
 * cost that lands after the deletion has somewhere to go. Returns the key
 * and when the period ends, or null when billing is off. A second deleted
 * account with the same key keeps the larger of the two.
 */
export async function storeDeletedUsage(
  ctx: MutationCtx,
  { userId, email }: { userId: string; email: string },
): Promise<{ emailKey: string; periodEnd: number } | null> {
  const now = Date.now();
  const plan = await getPlan(ctx, userId, now);
  if (!plan) return null;
  const period = creditPeriodAt(await latestCreditRow(ctx, userId), plan, now);
  const key = await emailKey(email);
  const kept = await findDeletedUsage(ctx, key);
  const periodEnd = Math.max(period.periodEnd, kept?.periodEnd ?? 0);
  if (kept) {
    await ctx.db.patch("deletedUsage", kept._id, {
      userId,
      creditsUsed: Math.max(period.creditsUsed, kept.creditsUsed),
      periodEnd,
    });
  } else {
    await ctx.db.insert("deletedUsage", {
      emailKey: key,
      userId,
      creditsUsed: period.creditsUsed,
      periodEnd,
    });
  }
  return { emailKey: key, periodEnd };
}

/** Adds a cost that landed after the user deleted their account. */
export async function addDeletedUsage(
  ctx: MutationCtx,
  { userId, credits }: { userId: string; credits: number },
) {
  const kept = await ctx.db
    .query("deletedUsage")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  if (kept) {
    await ctx.db.patch("deletedUsage", kept._id, {
      creditsUsed: kept.creditsUsed + credits,
    });
  }
}

/**
 * Starts a new account on the credits a deleted account with the same
 * email key used, when it signs up before that account's period ends. Its
 * first Free month opens with them. That month runs from sign-up like any
 * new account's, not to the deleted account's reset, which would grant
 * Free's credits twice in a few days.
 */
export async function takeDeletedUsage(
  ctx: MutationCtx,
  {
    userId,
    email,
    createdAt,
  }: { userId: string; email: string; createdAt: number },
) {
  const kept = await findDeletedUsage(ctx, await emailKey(email));
  if (!kept) return;
  await ctx.db.delete("deletedUsage", kept._id);
  if (kept.periodEnd <= createdAt) return;
  await ctx.db.insert("creditLedger", {
    userId,
    ...monthlyPeriod(createdAt, createdAt),
    creditsGranted: MONTHLY_CREDITS.free,
    creditsUsed: kept.creditsUsed,
  });
}
