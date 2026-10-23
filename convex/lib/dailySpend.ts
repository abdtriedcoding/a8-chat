/**
 * What a8 spends on models each UTC day, across all users, titles included,
 * and what each user's usage cost it. The cost recorder adds to both, and
 * the daily spend ceiling and each user's share of it cap them (checkSpend
 * in convex/rateLimits.ts). Each day's spend is spread over
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

/**
 * What the user's usage cost a8 on `now`'s UTC day, in dollars, titles
 * included. checkSpend caps it at the user's share of the daily spend
 * ceiling, so a few users can't spend the whole day's ceiling.
 */
export async function getUserDailySpend(
  ctx: QueryCtx,
  userId: string,
  now: number,
): Promise<number> {
  const row = await userDailySpendRow(ctx, userId);
  return row?.day === utcDay(now) ? row.usd : 0;
}

/** Adds `usd` to the user's spend on `now`'s UTC day. */
export async function addUserDailySpend(
  ctx: MutationCtx,
  userId: string,
  now: number,
  usd: number,
) {
  const day = utcDay(now);
  const row = await userDailySpendRow(ctx, userId);
  if (!row) {
    await ctx.db.insert("userDailySpend", { userId, day, usd });
  } else if (row.day === day) {
    await ctx.db.patch("userDailySpend", row._id, { usd: row.usd + usd });
  } else {
    await ctx.db.patch("userDailySpend", row._id, { day, usd });
  }
}

/** Deletes a deleted user's daily spend row. */
export async function deleteUserDailySpend(ctx: MutationCtx, userId: string) {
  const row = await userDailySpendRow(ctx, userId);
  if (row) await ctx.db.delete("userDailySpend", row._id);
}

async function userDailySpendRow(ctx: QueryCtx, userId: string) {
  return await ctx.db
    .query("userDailySpend")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

/** The UTC day `now` falls on, as "YYYY-MM-DD". */
function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}
