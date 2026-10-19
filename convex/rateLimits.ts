// See the docs at https://www.convex.dev/components/rate-limiter
import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { v, type Infer } from "convex/values";
import { BYTES_PER_MB, MAX_ATTACHMENT_SIZE_IN_BYTES } from "./lib/attachments";
import { ERROR_CODES } from "./lib/errors";
import { components } from "./_generated/api";
import type { ActionCtx, MutationCtx } from "./_generated/server";

const DAY = 24 * HOUR;

/** How many bytes one user can upload in a day. */
const DAILY_UPLOAD_BYTES = 500 * BYTES_PER_MB;

/**
 * How many upload URLs one user can have open, whose files aren't
 * registered yet. checkUploadBytes counts each as the largest file a8 takes,
 * and this many fill the day's bytes.
 */
export const MAX_OPEN_UPLOAD_URLS = Math.floor(
  DAILY_UPLOAD_BYTES / MAX_ATTACHMENT_SIZE_IN_BYTES,
);

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
  // nobody registers is deleted after a day (convex/attachments/cleanup.ts).
  userUploadUrls: { kind: "fixed window", rate: 60, period: HOUR },
  // Each user's registerUpload calls. Higher than userUploadUrls, since a
  // retry registers the same file again.
  userUploadRegistrations: { kind: "fixed window", rate: 120, period: HOUR },
  // Each user's daily upload bytes. Storage takes a file of any size, and a8
  // checks the size only after it's stored, so this caps what one account
  // can store. A full prompt of PDFs is 160 MB, so 500 MB is about
  // three of them. Windows open at 00:00 UTC, like dailySends.
  userDailyUploadBytes: {
    kind: "fixed window",
    rate: DAILY_UPLOAD_BYTES,
    period: DAY,
    start: 0,
  },
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
  // Each user's connector sign-in starts. Each one calls the vendor for
  // discovery and may register a client, so a script can't hammer the vendor
  // through a8.
  userConnectStarts: {
    kind: "token bucket",
    rate: 10,
    period: MINUTE,
    capacity: 10,
  },
  // Each user's shares and link updates. Each one copies a thread, so a
  // script can't fill the deployment with copies.
  userShares: { kind: "fixed window", rate: 30, period: HOUR },
  // Each user's dictation sockets: one for each tap on the mic, and one for
  // each warm-up before a tap (ADR 0012). a8 can't see how long a dictation
  // runs, so these cap how often a socket opens. Warm-ups make this several
  // times the number of dictations. A start isn't a Send.
  userDictationStarts: { kind: "fixed window", rate: 120, period: HOUR },
  // Windows open at 00:00 UTC, like dailySends.
  userDailyDictationStarts: {
    kind: "fixed window",
    rate: 600,
    period: DAY,
    start: 0,
  },
  // Everyone's dictation sockets together, a ceiling on the day's speech
  // spend. A warm-up that's never used costs nothing (ADR 0012). A
  // dictation runs 5 minutes at most, so this is 5,000 minutes a day at
  // worst. Windows open at 00:00 UTC, like dailySends.
  dailyDictationStarts: {
    kind: "fixed window",
    rate: 1000,
    period: DAY,
    start: 0,
  },
});

/** Why a Send was refused. The Send mutations return it instead of throwing. */
export const vRateLimited = v.object({
  code: v.literal(ERROR_CODES.RATE_LIMITED),
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
 * Whether a web search fits under the user's daily cap and the daily cap.
 * Counts nothing. Without a user ID it only checks the daily cap. Call
 * countWebSearch once the search has gone through.
 */
export async function checkWebSearch(
  ctx: GenericActionCtx<GenericDataModel>,
  userId: string | undefined,
): Promise<boolean> {
  if (userId) {
    const user = await rateLimiter.check(ctx, "userDailyWebSearches", {
      key: userId,
    });
    if (!user.ok) return false;
  }
  const daily = await rateLimiter.check(ctx, "dailyWebSearches");
  return daily.ok;
}

/**
 * Counts one web search against the daily cap and the user's daily cap.
 * Without a user ID it only counts against the daily cap.
 *
 * An action can't check and count in one transaction. Searches that run at
 * the same time can all get through checkWebSearch, so they can go over a
 * cap by a few. limit() doesn't count past a full cap.
 */
export async function countWebSearch(
  ctx: GenericActionCtx<GenericDataModel>,
  userId: string | undefined,
): Promise<void> {
  await rateLimiter.limit(ctx, "dailyWebSearches");
  if (userId) {
    await rateLimiter.limit(ctx, "userDailyWebSearches", { key: userId });
  }
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
 * Whether the user has daily upload bytes left for one more upload URL.
 * Counts nothing. `openUploadUrls` is how many URLs the user has whose files
 * aren't registered yet. Storage takes any size, so each of those, and the
 * new one, counts as the largest file a8 takes. Call countUploadBytes once a
 * file is registered.
 */
export async function checkUploadBytes(
  ctx: MutationCtx,
  userId: string,
  openUploadUrls: number,
): Promise<boolean> {
  if (openUploadUrls >= MAX_OPEN_UPLOAD_URLS) return false;
  const { ok } = await rateLimiter.check(ctx, "userDailyUploadBytes", {
    key: userId,
    count: (openUploadUrls + 1) * MAX_ATTACHMENT_SIZE_IN_BYTES,
  });
  return ok;
}

/**
 * Counts a stored file against the user's daily upload bytes. The file is
 * already stored, so when it doesn't fit it spends the rest of the day's
 * bytes. Nothing past them comes off the next day, which starts in full at
 * 00:00 UTC.
 */
export async function countUploadBytes(
  ctx: MutationCtx,
  userId: string,
  bytes: number,
): Promise<void> {
  const key = { key: userId };
  // limit() throws on a count over the whole day's bytes.
  const count = Math.min(bytes, DAILY_UPLOAD_BYTES);
  const { ok } = await rateLimiter.limit(ctx, "userDailyUploadBytes", {
    ...key,
    count,
  });
  if (ok) return;
  // A fresh window spent in full leaves 0 bytes until 00:00 UTC.
  await rateLimiter.reset(ctx, "userDailyUploadBytes", key);
  await rateLimiter.limit(ctx, "userDailyUploadBytes", {
    ...key,
    count: DAILY_UPLOAD_BYTES,
    throws: true,
  });
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

/**
 * Counts one connector sign-in start against the user's limit. Returns
 * false, and counts nothing, once the limit is hit.
 */
export async function limitConnectStart(
  ctx: MutationCtx,
  userId: string,
): Promise<boolean> {
  const { ok } = await rateLimiter.limit(ctx, "userConnectStarts", {
    key: userId,
  });
  return ok;
}

/**
 * Counts one share or link update against the user's limit. Returns the
 * milliseconds until one would go through, or null if this one can go
 * ahead.
 */
export async function limitShare(
  ctx: MutationCtx,
  userId: string,
): Promise<number | null> {
  const { ok, retryAfter } = await rateLimiter.limit(ctx, "userShares", {
    key: userId,
  });
  return ok ? null : retryAfter;
}

/**
 * Why a dictation start would be refused, or null if it fits under the
 * user's limits and the daily limit. Counts nothing. It checks the user's
 * limits first, so their messages win when both are hit.
 */
export async function checkDictationStart(
  ctx: RunMutationCtx,
  userId: string,
): Promise<RateLimited | null> {
  const key = { key: userId };
  const user = await rateLimiter.check(ctx, "userDictationStarts", key);
  if (!user.ok) {
    const minutes = Math.ceil(user.retryAfter / MINUTE);
    return rateLimited(
      `You hit the dictation limit. Try again in ${minutes} min.`,
      user.retryAfter,
    );
  }
  const userDaily = await rateLimiter.check(
    ctx,
    "userDailyDictationStarts",
    key,
  );
  if (!userDaily.ok) {
    return rateLimited(
      "You hit your daily dictation limit. It resets at 00:00 UTC.",
      userDaily.retryAfter,
    );
  }
  const daily = await rateLimiter.check(ctx, "dailyDictationStarts");
  if (!daily.ok) {
    return rateLimited(
      "a8 hit today's dictation limit. It resets at 00:00 UTC.",
      daily.retryAfter,
    );
  }
  return null;
}

/**
 * Counts one dictation start against the user's limits and the daily limit.
 * Returns why it can't, or null if the dictation can start. Like limitSend,
 * it checks every limit before counting against any.
 */
export async function limitDictationStart(
  ctx: MutationCtx,
  userId: string,
): Promise<RateLimited | null> {
  const refused = await checkDictationStart(ctx, userId);
  if (refused) return refused;
  const key = { key: userId };
  // Every check passed in this transaction, so none of these can fail.
  await rateLimiter.limit(ctx, "userDictationStarts", {
    ...key,
    throws: true,
  });
  await rateLimiter.limit(ctx, "userDailyDictationStarts", {
    ...key,
    throws: true,
  });
  await rateLimiter.limit(ctx, "dailyDictationStarts", { throws: true });
  return null;
}

/**
 * Deletes a deleted user's rate limit counters. The sign-in counter's key is
 * the email. Better Auth's own counters are keyed by IP and path, not user.
 */
export async function resetUserLimits(
  ctx: RunMutationCtx,
  userId: string,
  email: string,
) {
  const key = { key: userId };
  await rateLimiter.reset(ctx, "userSends", key);
  await rateLimiter.reset(ctx, "userDailySends", key);
  await rateLimiter.reset(ctx, "userDailyWebSearches", key);
  await rateLimiter.reset(ctx, "userUploadUrls", key);
  await rateLimiter.reset(ctx, "userUploadRegistrations", key);
  await rateLimiter.reset(ctx, "userDailyUploadBytes", key);
  await rateLimiter.reset(ctx, "userConnectorToolCalls", key);
  await rateLimiter.reset(ctx, "userConnectStarts", key);
  await rateLimiter.reset(ctx, "userShares", key);
  await rateLimiter.reset(ctx, "userDictationStarts", key);
  await rateLimiter.reset(ctx, "userDailyDictationStarts", key);
  await rateLimiter.reset(ctx, "signInByEmail", {
    key: email.trim().toLowerCase(),
  });
}

function rateLimited(message: string, retryAfter: number): RateLimited {
  return { code: ERROR_CODES.RATE_LIMITED, message, retryAfter };
}
