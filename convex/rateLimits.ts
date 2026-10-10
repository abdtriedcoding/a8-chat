// See the docs at https://www.convex.dev/components/rate-limiter
import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { v, type Infer } from "convex/values";
import { components } from "./_generated/api";
import type { ActionCtx, MutationCtx } from "./_generated/server";

const DAY = 24 * HOUR;

/** Any ctx that can run a mutation: an action or a mutation. */
type RunMutationCtx = ActionCtx | MutationCtx;

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Each user's Sends, so a script or a stuck key can't run up the bill.
  userSends: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 10 },
  // Everyone's Sends together, a ceiling on the day's model spend. Windows
  // count from `start`, and 0 is midnight UTC, so each day's window opens at
  // 00:00 UTC. Without `start`, the component picks a random time of day.
  dailySends: { kind: "fixed window", rate: 500, period: DAY, start: 0 },
  // One user's share of dailySends, a fifth of it. Five users can use up the
  // day's cap, but one can't. Windows open at 00:00 UTC, like dailySends.
  userDailySends: { kind: "fixed window", rate: 100, period: DAY, start: 0 },
  // Everyone's web searches together. 30 a day stays inside Tavily's free
  // tier of 1,000 a month. Windows open at 00:00 UTC, like dailySends.
  dailyWebSearches: { kind: "fixed window", rate: 30, period: DAY, start: 0 },
  // One user's share of dailyWebSearches, a third of it. Windows open at
  // 00:00 UTC, like dailySends.
  userDailyWebSearches: {
    kind: "fixed window",
    rate: 10,
    period: DAY,
    start: 0,
  },
  // Each user's upload URLs, so one account can't fill storage. An upload
  // nobody registers is deleted after a day (convex/attachments.ts).
  userUploadUrls: { kind: "fixed window", rate: 60, period: HOUR },
  // Each user's registerUpload calls. Higher than userUploadUrls, since a
  // retry registers the same file again.
  userUploadRegistrations: { kind: "fixed window", rate: 120, period: HOUR },
  // Sign-in attempts for one email, wrong passwords included. Better Auth's
  // limit by IP may not see the client IP behind the Next proxy, so this one
  // holds without it. The key is the lowercased email.
  signInByEmail: { kind: "fixed window", rate: 5, period: MINUTE },
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
 * Counts one Send against the user's limits and the daily limit. Returns why
 * it can't, or null if the Send can go ahead. Call it before the Send saves
 * anything.
 *
 * It checks every limit before counting against any, so a refused Send
 * isn't counted. The user's limits are checked before the daily one, so
 * their messages win when both are hit.
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
  const userDaily = await rateLimiter.check(ctx, "userDailySends", {
    key: userId,
  });
  if (!userDaily.ok) {
    return rateLimited(
      "You hit your daily limit. It resets at 00:00 UTC.",
      userDaily.retryAfter,
    );
  }
  const daily = await rateLimiter.check(ctx, "dailySends");
  if (!daily.ok) {
    return rateLimited(
      "a8 hit today's limit. It resets at 00:00 UTC.",
      daily.retryAfter,
    );
  }
  // Every check passed in this transaction, so none of these can fail.
  await rateLimiter.limit(ctx, "userSends", { key: userId, throws: true });
  await rateLimiter.limit(ctx, "userDailySends", {
    key: userId,
    throws: true,
  });
  await rateLimiter.limit(ctx, "dailySends", { throws: true });
  return null;
}

/**
 * Counts one web search against the user's daily cap and the daily cap.
 * Returns false, and counts nothing, once either is hit. Without a user ID it
 * only counts against the daily cap.
 *
 * An action can't check and count in one transaction. The user's cap is
 * checked first, then the daily cap is counted, then the user's. Searches
 * that run at the same time can pass the user's cap by a few.
 */
export async function limitWebSearch(
  ctx: GenericActionCtx<GenericDataModel>,
  userId: string | undefined,
): Promise<boolean> {
  if (userId) {
    const user = await rateLimiter.check(ctx, "userDailyWebSearches", {
      key: userId,
    });
    if (!user.ok) return false;
  }
  const daily = await rateLimiter.limit(ctx, "dailyWebSearches");
  if (!daily.ok) return false;
  if (userId) {
    await rateLimiter.limit(ctx, "userDailyWebSearches", { key: userId });
  }
  return true;
}

/**
 * Counts one sign-in attempt for an email. Returns the milliseconds until an
 * attempt would go through, or null if this one can go ahead.
 */
export async function limitSignIn(
  ctx: RunMutationCtx,
  email: string,
): Promise<number | null> {
  const { ok, retryAfter } = await rateLimiter.limit(ctx, "signInByEmail", {
    key: email.trim().toLowerCase(),
  });
  return ok ? null : retryAfter;
}

/**
 * Counts one upload URL against the user's limit. Returns false, and counts
 * nothing, once the limit is hit.
 */
export async function limitUploadUrl(
  ctx: MutationCtx,
  userId: string,
): Promise<boolean> {
  const { ok } = await rateLimiter.limit(ctx, "userUploadUrls", {
    key: userId,
  });
  return ok;
}

/**
 * Counts one registerUpload call against the user's limit. Returns false,
 * and counts nothing, once the limit is hit.
 */
export async function limitUploadRegistration(
  ctx: MutationCtx,
  userId: string,
): Promise<boolean> {
  const { ok } = await rateLimiter.limit(ctx, "userUploadRegistrations", {
    key: userId,
  });
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
