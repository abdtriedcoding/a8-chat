// See the docs at https://www.convex.dev/components/rate-limiter
import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { v, type Infer } from "convex/values";
import { components } from "./_generated/api";
import type { ActionCtx, MutationCtx } from "./_generated/server";

const DAY = 24 * HOUR;

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Each user's Sends, so a script or a stuck key can't run up the bill.
  userSends: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 10 },
  // Everyone's Sends together, a ceiling on the day's model spend. Windows
  // count from `start`, and 0 is midnight UTC, so each day's window opens at
  // 00:00 UTC. Without `start`, the component picks a random time of day.
  dailySends: { kind: "fixed window", rate: 500, period: DAY, start: 0 },
  // Everyone's web searches together. 30 a day stays inside Tavily's free
  // tier of 1,000 a month. Windows open at 00:00 UTC, like dailySends.
  dailyWebSearches: { kind: "fixed window", rate: 30, period: DAY, start: 0 },
  // Each user's connector tool calls, reads and actions both, so a reply
  // stuck calling tools can't run up the bill or hammer the vendor. Web
  // searches don't count here. Windows open at 00:00 UTC, like dailySends.
  userConnectorToolCalls: {
    kind: "fixed window",
    rate: 300,
    period: DAY,
    start: 0,
  },
});

/** Why a Send was refused. The Send mutations return it instead of throwing. */
export const vRateLimited = v.object({
  code: v.literal("RATE_LIMITED"),
  message: v.string(),
  // Milliseconds until a Send would go through.
  retryAfter: v.number(),
});

export type RateLimited = Infer<typeof vRateLimited>;

/**
 * Counts one Send against the user's limit and the daily limit. Returns why
 * it can't, or null if the Send can go ahead. Call it before the Send saves
 * anything.
 *
 * It checks both limits before counting against either, so a refused Send
 * isn't counted. The user's limit is checked first, so its message wins
 * when both are hit.
 */
export async function limitSend(
  ctx: MutationCtx,
  userId: string,
): Promise<RateLimited | null> {
  const user = await rateLimiter.check(ctx, "userSends", { key: userId });
  if (!user.ok) {
    const seconds = Math.ceil(user.retryAfter / 1000);
    return rateLimited(`Slow down: try again in ${seconds}s.`, user.retryAfter);
  }
  const daily = await rateLimiter.check(ctx, "dailySends");
  if (!daily.ok) {
    return rateLimited(
      "a8 hit today's limit. It resets at 00:00 UTC.",
      daily.retryAfter,
    );
  }
  // Both checks passed in this transaction, so neither of these can fail.
  await rateLimiter.limit(ctx, "userSends", { key: userId, throws: true });
  await rateLimiter.limit(ctx, "dailySends", { throws: true });
  return null;
}

/**
 * Counts one web search against the daily cap. Returns false, and counts
 * nothing, once the cap is hit.
 */
export async function limitWebSearch(
  ctx: GenericActionCtx<GenericDataModel>,
): Promise<boolean> {
  const { ok } = await rateLimiter.limit(ctx, "dailyWebSearches");
  return ok;
}

/**
 * Counts one connector tool call against the user's daily limit. Returns
 * false, and counts nothing, once the limit is hit.
 */
export async function limitConnectorToolCall(
  ctx: ActionCtx,
  userId: string,
): Promise<boolean> {
  const { ok } = await rateLimiter.limit(ctx, "userConnectorToolCalls", {
    key: userId,
  });
  return ok;
}

function rateLimited(message: string, retryAfter: number): RateLimited {
  return { code: "RATE_LIMITED", message, retryAfter };
}
