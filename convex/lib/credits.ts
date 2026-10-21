/**
 * The credit ledger: one creditLedger row per user per credit period. A
 * credit is one US cent of model cost (GLOSSARY.md). Rows open lazily, on
 * the first usage in a period, and resolveCreditPeriod decides which row
 * covers now.
 */
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Plan } from "./billing";
import { resolveCreditPeriod } from "./creditPeriod";

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
