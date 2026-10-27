// See the docs at https://www.convex.dev/components/rate-limiter
import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { v, type Infer } from "convex/values";
import { BYTES_PER_MB, MAX_ATTACHMENT_SIZE_IN_BYTES } from "./lib/attachments";
import {
  billingEnabled,
  DAILY_SPEND_SHARES,
  dailySpendCeilingUsd,
  planAt,
  type PlanTerms,
} from "./lib/billing";
import { totalHeldCredits, userHeldCredits } from "./lib/creditHolds";
import { creditPeriodAt, creditsLeft } from "./lib/creditPeriod";
import { CREDITS_PER_USD, latestCreditRow } from "./lib/credits";
import { getDailySpend, getUserDailySpend } from "./lib/dailySpend";
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
  // Everyone's Sends together, a ceiling on the day's model spend.
  // Self-hosted only: the hosted a8 caps spend with credits and the daily
  // spend ceiling instead. Windows count from `start`, and 0 is midnight UTC,
  // so each day's window opens at 00:00 UTC. Without `start`, the component
  // picks a random time of day.
  //
  // Every self-hosted Send counts here, so one row would make Sends from
  // different users conflict. The shards split the cap into 10 rows of 50.
  // A Send counts on whichever of two random shards has more left, or on
  // both when neither has room alone. The cap never goes over 500, but a Send can be
  // refused a little before it, when the two shards it picks are both spent.
  dailySends: {
    kind: "fixed window",
    rate: 500,
    period: DAY,
    start: 0,
    shards: 10,
  },
  // One user's share of dailySends, a fifth of it. Five users can use up the
  // day's cap, but one can't. Self-hosted only, like dailySends. Windows
  // open at 00:00 UTC, like dailySends.
  userDailySends: { kind: "fixed window", rate: 100, period: DAY, start: 0 },
  // Everyone's web searches together. 30 a day stays inside Tavily's free
  // tier of 1,000 a month. Self-hosted only: on the hosted a8 each search
  // costs a credit, so credits and the daily spend ceiling cap them instead.
  // Windows open at 00:00 UTC, like dailySends.
  dailyWebSearches: { kind: "fixed window", rate: 30, period: DAY, start: 0 },
  // One user's web searches. Windows open at 00:00 UTC, like dailySends.
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
  // Wrong passwords for one email from one IP. Only failures count, so
  // someone else's guesses from another IP don't lock the owner out. The key
  // is the lowercased email and the IP. Without an IP this limit is skipped,
  // since an email-only key at this rate would let anyone lock the owner out.
  signInFailures: { kind: "fixed window", rate: 5, period: MINUTE },
  // Wrong passwords for one email from any IP, so guesses spread over many
  // IPs still stop. Better Auth lets one IP try 10 sign-ins a minute, so one
  // IP alone can't hit this limit. The key is the lowercased email. A
  // browser that signed in to the email before uses signInFailuresByDevice
  // instead, so guesses from other IPs can't lock the owner out.
  signInFailuresByEmail: { kind: "fixed window", rate: 20, period: MINUTE },
  // Wrong passwords for one email from a browser that signed in to it before,
  // in place of signInFailuresByEmail. The key is the lowercased email and the
  // device ID from the browser's device cookie (lib/signInDevice.ts).
  signInFailuresByDevice: { kind: "fixed window", rate: 5, period: MINUTE },
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
  // Each user's app install checks. The Connectors page runs one each time
  // it opens, and each calls the vendor, so reloads can't hammer it. Apart
  // from userConnectStarts, so reloading never blocks a connect.
  userAppInstallChecks: {
    kind: "token bucket",
    rate: 10,
    period: MINUTE,
    capacity: 10,
  },
  // Each user's shares and link updates. Each one copies a thread, so a
  // script can't fill the deployment with copies.
  userShares: { kind: "fixed window", rate: 30, period: HOUR },
  // Each user's new scheduled prompts. Each one makes a thread, so a script
  // can't fill the deployment with threads by creating and deleting them.
  userScheduledPromptCreates: { kind: "fixed window", rate: 20, period: HOUR },
  // Each user's dictation sockets: one for each tap on the mic, and one for
  // each warm-up before a tap (ADR 0012). a8 can't see how long a dictation
  // runs, so these cap how often a socket opens. Warm-ups make this several
  // times the number of dictations. A start isn't a Send.
  userDictationStarts: { kind: "fixed window", rate: 120, period: HOUR },
  // Each user's dictation sockets in a day, by plan (dailyDictationLimit).
  // Self-hosted a8 has no plans and uses userDailyDictationStarts. Windows
  // open at 00:00 UTC, like dailySends.
  userDailyDictationStarts: {
    kind: "fixed window",
    rate: 600,
    period: DAY,
    start: 0,
  },
  freeUserDailyDictationStarts: {
    kind: "fixed window",
    rate: 60,
    period: DAY,
    start: 0,
  },
  proUserDailyDictationStarts: {
    kind: "fixed window",
    rate: 300,
    period: DAY,
    start: 0,
  },
  // Everyone's dictation sockets together, a ceiling on the day's speech
  // spend. A warm-up that's never used costs nothing (ADR 0012). The client
  // ends a dictation after 5 minutes, so this is 5,000 minutes a day unless
  // a script holds its sockets open. Windows open at 00:00 UTC, like
  // dailySends.
  dailyDictationStarts: {
    kind: "fixed window",
    rate: 1000,
    period: DAY,
    start: 0,
  },
});

/** Why a rate limit refused a Send or a dictation start. */
export const vRateLimited = v.object({
  code: v.literal(ERROR_CODES.RATE_LIMITED),
  message: v.string(),
});

export type RateLimited = Infer<typeof vRateLimited>;

/**
 * Why limitSend refused a Send: a rate limit, or on the hosted a8, no
 * credits left or the daily spend ceiling (checkSpend). The Send mutations
 * return it instead of throwing, and so does the dictation token action.
 */
export const vSendLimited = v.object({
  code: v.union(
    v.literal(ERROR_CODES.RATE_LIMITED),
    v.literal(ERROR_CODES.OUT_OF_CREDITS),
    v.literal(ERROR_CODES.DAILY_SPEND_CEILING),
  ),
  message: v.string(),
});

export type SendLimited = Infer<typeof vSendLimited>;

/**
 * Counts one Send against the user's limits and the daily limits. Returns
 * why it can't, or null if the Send can go ahead. Call it before the Send
 * saves anything.
 *
 * The hosted a8 has no daily Send caps. It checks the user's credits and
 * the daily spend ceiling instead (checkSpend), and counts nothing against
 * them. Self-hosted a8 has no credits, so it keeps the daily Send caps.
 *
 * It checks every limit before counting against any, so a refused Send
 * isn't counted. The user's limits are checked before the daily ones, so
 * their messages win when both are hit. `plan` is the user's plan terms
 * (getPlanTerms), for checkSpend.
 */
export async function limitSend(
  ctx: MutationCtx,
  userId: string,
  plan: PlanTerms | null,
): Promise<SendLimited | null> {
  const user = await rateLimiter.check(ctx, "userSends", { key: userId });
  if (!user.ok) {
    const seconds = Math.ceil(user.retryAfter / 1000);
    return rateLimited(`Slow down: try again in ${seconds}s.`);
  }
  if (billingEnabled) {
    const refused = await checkSpend(ctx, userId, plan);
    if (refused) return refused;
    // The check passed in this transaction, so this can't fail.
    await rateLimiter.limit(ctx, "userSends", { key: userId, throws: true });
    return null;
  }
  const userDaily = await rateLimiter.check(ctx, "userDailySends", {
    key: userId,
  });
  if (!userDaily.ok) {
    return rateLimited("You hit your daily limit. It resets at 00:00 UTC.");
  }
  // A check and a limit on dailySends can pick different shards, so this
  // counts it in one go. limit() counts nothing when it refuses.
  const daily = await rateLimiter.limit(ctx, "dailySends");
  if (!daily.ok) {
    return rateLimited("a8 hit today's limit. It resets at 00:00 UTC.");
  }
  // Both checks passed in this transaction, so neither of these can fail.
  await rateLimiter.limit(ctx, "userSends", { key: userId, throws: true });
  await rateLimiter.limit(ctx, "userDailySends", {
    key: userId,
    throws: true,
  });
  return null;
}

/**
 * Why the hosted a8 would refuse the user's Send for spend, or null if it
 * can go ahead: the user has no credits left, the user's spend today
 * reached their share of the daily ceiling (DAILY_SPEND_SHARES), or a8's
 * spend today reached the ceiling. Credit holds count as spent
 * (lib/creditHolds.ts), since a cost lands seconds after each model call.
 * A refusal that only the holds cause says to wait, not that the limit is
 * reached, since a hold can cost less than it holds. Null when billing is
 * off.
 *
 * Only the holds of replies and costs already on their way count. The
 * caller holds the new reply once it schedules it (holdReply). A reply
 * that starts always finishes, even if its cost takes the balance below
 * zero. limitSend calls this, and so does a queued prompt when it starts,
 * since queueing it counted it already. `plan` is the user's plan terms
 * (getPlanTerms).
 */
export async function checkSpend(
  ctx: MutationCtx,
  userId: string,
  plan: PlanTerms | null,
): Promise<SendLimited | null> {
  if (!plan) return null;
  const now = Date.now();
  const period = creditPeriodAt(
    await latestCreditRow(ctx, userId),
    planAt(plan, now),
    now,
  );
  const left = creditsLeft(period);
  if (left <= 0) {
    return {
      code: ERROR_CODES.OUT_OF_CREDITS,
      message:
        plan.name === "free"
          ? "You're out of credits. Upgrade to Pro, or wait for them to reset."
          : "You're out of credits until they reset.",
    };
  }
  const held = await userHeldCredits(ctx, userId, now);
  // The balance still shows credits, so this says to wait, not to upgrade.
  if (left - held <= 0) return waitForReplies();
  const share = dailySpendCeilingUsd * DAILY_SPEND_SHARES[plan.name];
  const userSpend = await getUserDailySpend(ctx, userId, now);
  if (userSpend >= share) {
    return {
      code: ERROR_CODES.DAILY_SPEND_CEILING,
      message: "You hit today's usage limit. It resets at 00:00 UTC.",
    };
  }
  if (userSpend + held / CREDITS_PER_USD >= share) return waitForReplies();
  const dailySpend = await getDailySpend(ctx, now);
  if (dailySpend >= dailySpendCeilingUsd) {
    return {
      code: ERROR_CODES.DAILY_SPEND_CEILING,
      message: "a8 is at capacity for today. It resets at 00:00 UTC.",
    };
  }
  const totalHeld = await totalHeldCredits(ctx, now);
  if (dailySpend + totalHeld / CREDITS_PER_USD >= dailySpendCeilingUsd) {
    return rateLimited(
      "a8 is close to today's capacity. Try again in a few minutes.",
    );
  }
  return null;
}

function waitForReplies(): RateLimited {
  return rateLimited(
    "Your other replies are still using credits. Try again once they finish.",
  );
}

/**
 * Whether a web search fits under the user's daily cap and the daily cap.
 * Counts nothing. Without a user ID it only checks the daily cap, and on the
 * hosted a8 with one it only checks the user's (usesDailyWebSearches). Call
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
  if (!usesDailyWebSearches(userId)) return true;
  const daily = await rateLimiter.check(ctx, "dailyWebSearches");
  return daily.ok;
}

/**
 * Counts one web search against the user's daily cap and the daily cap, as
 * checkWebSearch checks them.
 *
 * An action can't check and count in one transaction. Searches that run at
 * the same time can all get through checkWebSearch, so they can go over a
 * cap by a few. limit() doesn't count past a full cap.
 */
export async function countWebSearch(
  ctx: GenericActionCtx<GenericDataModel>,
  userId: string | undefined,
): Promise<void> {
  if (usesDailyWebSearches(userId)) {
    await rateLimiter.limit(ctx, "dailyWebSearches");
  }
  if (userId) {
    await rateLimiter.limit(ctx, "userDailyWebSearches", { key: userId });
  }
}

/**
 * Whether a web search counts against dailyWebSearches. On the hosted a8 a
 * user's search costs them a credit, so only a search without a user does.
 */
function usesDailyWebSearches(userId: string | undefined) {
  return !billingEnabled || !userId;
}

/**
 * A password sign-in: the email as typed, the client IP, or null when
 * Better Auth can't read it, and the device ID from the browser's device
 * cookie for the email (lib/signInDevice.ts), or null without one.
 */
export type SignInAttempt = {
  email: string;
  ip: string | null;
  device: string | null;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/** The signInFailures key, or null without an IP. */
function emailAndIpKey({ email, ip }: SignInAttempt) {
  return ip ? `${normalizeEmail(email)}|${ip}` : null;
}

/**
 * The limit for a sign-in's wrong passwords from any IP, and its key:
 * signInFailuresByDevice from a browser with a device cookie, or else
 * signInFailuresByEmail.
 */
function emailWideLimit({ email, device }: SignInAttempt) {
  return device
    ? {
        name: "signInFailuresByDevice" as const,
        key: `${normalizeEmail(email)}|${device}`,
      }
    : { name: "signInFailuresByEmail" as const, key: normalizeEmail(email) };
}

/**
 * Checks a sign-in against the wrong-password limits, without counting it.
 * Returns the milliseconds until a sign-in would go through, or null if this
 * one can go ahead.
 */
export async function checkSignIn(
  ctx: RunMutationCtx,
  attempt: SignInAttempt,
): Promise<number | null> {
  const key = emailAndIpKey(attempt);
  if (key) {
    const { ok, retryAfter } = await rateLimiter.check(ctx, "signInFailures", {
      key,
    });
    if (!ok) return retryAfter;
  }
  const { name, key: wideKey } = emailWideLimit(attempt);
  const { ok, retryAfter } = await rateLimiter.check(ctx, name, {
    key: wideKey,
  });
  return ok ? null : retryAfter;
}

/** Counts a wrong password against the sign-in limits. */
export async function countFailedSignIn(
  ctx: RunMutationCtx,
  attempt: SignInAttempt,
): Promise<void> {
  const key = emailAndIpKey(attempt);
  if (key) await rateLimiter.limit(ctx, "signInFailures", { key });
  const { name, key: wideKey } = emailWideLimit(attempt);
  await rateLimiter.limit(ctx, name, { key: wideKey });
}

/**
 * Clears the email and IP's wrong passwords, and the device's, after a
 * sign-in goes through, so the owner's own typos stop counting. The
 * email-only count stays, since it holds other IPs' guesses too.
 */
export async function clearSignInFailures(
  ctx: RunMutationCtx,
  attempt: SignInAttempt,
): Promise<void> {
  const key = emailAndIpKey(attempt);
  if (key) await rateLimiter.reset(ctx, "signInFailures", { key });
  const wide = emailWideLimit(attempt);
  if (wide.name === "signInFailuresByDevice") {
    await rateLimiter.reset(ctx, wide.name, { key: wide.key });
  }
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
 * Counts one app install check against the user's limit. Returns false,
 * and counts nothing, once the limit is hit.
 */
export async function limitAppInstallCheck(
  ctx: MutationCtx,
  userId: string,
): Promise<boolean> {
  const { ok } = await rateLimiter.limit(ctx, "userAppInstallChecks", {
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
 * Counts one new scheduled prompt against the user's limit. Returns the
 * milliseconds until one would go through, or null if this one can go
 * ahead.
 */
export async function limitScheduledPromptCreate(
  ctx: MutationCtx,
  userId: string,
): Promise<number | null> {
  const { ok, retryAfter } = await rateLimiter.limit(
    ctx,
    "userScheduledPromptCreates",
    { key: userId },
  );
  return ok ? null : retryAfter;
}

/** Each plan's daily dictation start limit on the hosted a8. */
const DAILY_DICTATION_LIMITS = {
  free: "freeUserDailyDictationStarts",
  pro: "proUserDailyDictationStarts",
} as const;

/**
 * The user's daily dictation start limit: their plan's on the hosted a8,
 * or userDailyDictationStarts on self-hosted a8, where `plan` is null.
 */
function dailyDictationLimit(plan: PlanTerms | null) {
  return plan ? DAILY_DICTATION_LIMITS[plan.name] : "userDailyDictationStarts";
}

/**
 * Why a dictation start would be refused, or null if it fits under the
 * user's limits and the daily limit. Counts nothing. It checks the user's
 * limits first, so their messages win when both are hit. `plan` is the
 * user's plan terms (getPlanTerms), for the daily limit.
 */
export async function checkDictationStart(
  ctx: MutationCtx,
  userId: string,
  plan: PlanTerms | null,
): Promise<RateLimited | null> {
  const key = { key: userId };
  const user = await rateLimiter.check(ctx, "userDictationStarts", key);
  if (!user.ok) {
    const minutes = Math.ceil(user.retryAfter / MINUTE);
    return rateLimited(
      `You hit the dictation limit. Try again in ${minutes} min.`,
    );
  }
  const userDaily = await rateLimiter.check(
    ctx,
    dailyDictationLimit(plan),
    key,
  );
  if (!userDaily.ok) {
    return rateLimited(
      "You hit your daily dictation limit. It resets at 00:00 UTC.",
    );
  }
  const daily = await rateLimiter.check(ctx, "dailyDictationStarts");
  if (!daily.ok) {
    return rateLimited(
      "a8 hit today's dictation limit. It resets at 00:00 UTC.",
    );
  }
  return null;
}

/**
 * Counts one dictation start against the user's limits and the daily limit.
 * Call it only once checkDictationStart has passed in the same transaction,
 * so no limit is counted unless all of them have room.
 */
export async function countDictationStart(
  ctx: MutationCtx,
  userId: string,
  plan: PlanTerms | null,
): Promise<void> {
  const key = { key: userId };
  // Every check passed in this transaction, so none of these can fail.
  await rateLimiter.limit(ctx, "userDictationStarts", {
    ...key,
    throws: true,
  });
  await rateLimiter.limit(ctx, dailyDictationLimit(plan), {
    ...key,
    throws: true,
  });
  await rateLimiter.limit(ctx, "dailyDictationStarts", { throws: true });
}

/**
 * Deletes a deleted user's rate limit counters. The email alone can't find
 * the signInFailures and signInFailuresByDevice counters, whose keys hold
 * an IP or a device ID too. Better Auth's own counters are keyed by IP and
 * path, not user.
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
  await rateLimiter.reset(ctx, "userAppInstallChecks", key);
  await rateLimiter.reset(ctx, "userShares", key);
  await rateLimiter.reset(ctx, "userScheduledPromptCreates", key);
  await rateLimiter.reset(ctx, "userDictationStarts", key);
  await rateLimiter.reset(ctx, "userDailyDictationStarts", key);
  await rateLimiter.reset(ctx, "freeUserDailyDictationStarts", key);
  await rateLimiter.reset(ctx, "proUserDailyDictationStarts", key);
  await rateLimiter.reset(ctx, "signInFailuresByEmail", {
    key: normalizeEmail(email),
  });
}

function rateLimited(message: string): RateLimited {
  return { code: ERROR_CODES.RATE_LIMITED, message };
}
