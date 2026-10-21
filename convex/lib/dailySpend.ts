/**
 * What a8 spends on models each UTC day, across all users, titles included.
 * The cost recorder adds to it, and the daily spend ceiling caps it
 * (checkSpend in convex/rateLimits.ts). Each day's spend is spread over
 * DAILY_SPEND_SHARDS rows, so recorders running at once rarely write the
 * same row.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";

const DAILY_SPEND_SHARDS = 8;

/** What a8 spent on models on `now`'s UTC day, in dollars. */
export async function getDailySpend(
  ctx: QueryCtx,
  now: number,
): Promise<number> {
  const shards = await ctx.db
    .query("dailySpend")
    .withIndex("by_day_and_shard", (q) => q.eq("day", utcDay(now)))
    .take(DAILY_SPEND_SHARDS);
  return shards.reduce((usd, shard) => usd + shard.usd, 0);
}

/** Adds `usd` to `now`'s UTC day, in one of its shards. */
export async function addDailySpend(
  ctx: MutationCtx,
  now: number,
  usd: number,
) {
  const day = utcDay(now);
  const shard = Math.floor(Math.random() * DAILY_SPEND_SHARDS);
  const row = await ctx.db
    .query("dailySpend")
    .withIndex("by_day_and_shard", (q) => q.eq("day", day).eq("shard", shard))
    .unique();
  if (row) {
    await ctx.db.patch("dailySpend", row._id, { usd: row.usd + usd });
  } else {
    await ctx.db.insert("dailySpend", { day, shard, usd });
  }
}

/** The UTC day `now` falls on, as "YYYY-MM-DD". */
function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}
