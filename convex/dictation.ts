// Dictation's backend, and with useDictation the only code that knows about
// Deepgram (ADR 0012). The browser streams audio straight to Deepgram, so
// a8 never sees the audio or the words. All it does is mint the token that
// opens the browser's socket. See
// https://developers.deepgram.com/reference/token-based-auth-api/grant-token
import { v, type Infer } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import {
  action,
  env,
  internalMutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { getPlanTerms, type PlanTerms } from "./lib/billing";
import { appError, ERROR_CODES } from "./lib/errors";
import { requireUser } from "./lib/guards";
import { recordDictation } from "./lib/usage";
import {
  checkDictationStart,
  checkSpend,
  countDictationStart,
  vSendLimited,
  type SendLimited,
} from "./rateLimits";

const DEEPGRAM_GRANT_URL = "https://api.deepgram.com/v1/auth/grant";
/**
 * How long a token can open a socket for. An open socket outlives it, so
 * this doesn't limit a dictation's length.
 */
const TOKEN_TTL_SECONDS = 30;

/**
 * How long `token` waits before each retry of a grant request that didn't
 * reach Deepgram, or that Deepgram answered with a 429 or a 5xx.
 */
const GRANT_RETRY_DELAYS_MS = [250, 1000];

const grantResponse = z.object({ access_token: z.string().min(1) });

/**
 * Deepgram couldn't grant a token, after retries. `token` returns it instead
 * of throwing, so a failed prewarm logs nothing in the browser.
 */
const vGrantFailed = v.object({
  code: v.literal(ERROR_CODES.CONNECT_FAILED),
  message: v.string(),
});

export type GrantFailed = Infer<typeof vGrantFailed>;

/** What `token` returns. */
export type TokenResult = { token: string } | SendLimited | GrantFailed;

/** Whether dictation is set up. It needs the optional DEEPGRAM_API_KEY. */
export const available = query({
  args: {},
  returns: v.boolean(),
  handler: async () => Boolean(env.DEEPGRAM_API_KEY),
});

/**
 * A token that opens one Deepgram socket, for the signed-in user. Counts a
 * dictation start against the rate limits and, on the hosted a8, charges a
 * credit for it (recordDictation). Returns the refusal instead of throwing
 * when a limit is hit, like the Send mutations. It counts and charges only
 * once Deepgram grants the token, so a failed grant costs nothing. A grant
 * that fails on the network, is rate limited by Deepgram or fails on its
 * side is retried, and then returned as GrantFailed.
 */
export const token = action({
  args: {},
  returns: v.union(v.object({ token: v.string() }), vSendLimited, vGrantFailed),
  handler: async (ctx): Promise<TokenResult> => {
    // Refuses before calling Deepgram, so a user over a limit, or whose
    // session has ended, can't make a8 call it. countStart checks again in
    // one transaction with the count.
    const refused = await ctx.runMutation(internal.dictation.checkStart, {});
    if (refused) return refused;
    const apiKey = env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw appError(
        ERROR_CODES.MISCONFIGURED,
        "Dictation isn't set up on this deployment.",
      );
    }

    const response = await requestGrant(apiKey);
    if (!response) {
      return {
        code: ERROR_CODES.CONNECT_FAILED,
        message: "Dictation couldn't connect. Please try again.",
      };
    }
    // Deepgram answers a wrong key with 400 and a key without the Member
    // role with 403.
    if ([400, 401, 403].includes(response.status)) {
      throw appError(
        ERROR_CODES.MISCONFIGURED,
        "Dictation isn't set up right on this deployment. Ask whoever runs this a8 to check DEEPGRAM_API_KEY.",
      );
    }
    if (!response.ok) {
      throw new Error(`Deepgram didn't grant a token: ${response.status}`);
    }
    const { access_token } = grantResponse.parse(await response.json());
    const refusedAtCount = await ctx.runMutation(
      internal.dictation.countStart,
      {},
    );
    return refusedAtCount ?? { token: access_token };
  },
});

/**
 * Asks Deepgram for a token, with retries. Null if every try failed on the
 * network or got a 429 or a 5xx, which say nothing about the key. Any other
 * answer comes back for `token` to read.
 */
async function requestGrant(apiKey: string): Promise<Response | null> {
  for (const delay of [0, ...GRANT_RETRY_DELAYS_MS]) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const response = await fetch(DEEPGRAM_GRANT_URL, {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
      });
      if (response.status !== 429 && response.status < 500) return response;
    } catch {
      // The request didn't reach Deepgram, so try again.
    }
  }
  return null;
}

/**
 * Why `token` would refuse the signed-in user, or null. Counts nothing.
 * Throws when signed out. requireUser reads the session row, since the JWT
 * an action sees stays valid for up to 15 minutes after sign-out.
 */
export const checkStart = internalMutation({
  args: {},
  returns: v.union(vSendLimited, v.null()),
  handler: async (ctx) => (await checkUserStart(ctx)).refused,
});

/** Counts a dictation start for `token`, and charges for it. */
export const countStart = internalMutation({
  args: {},
  returns: v.union(vSendLimited, v.null()),
  handler: async (ctx) => {
    const { userId, plan, refused } = await checkUserStart(ctx);
    if (refused) return refused;
    await countDictationStart(ctx, userId, plan);
    await recordDictation(ctx, userId);
    return null;
  },
});

/**
 * The signed-in user, their plan terms, and why a dictation start would be
 * refused: a rate limit, or on the hosted a8, no credits left or the daily
 * spend ceiling (checkSpend). `refused` is null if it can go ahead. Counts
 * nothing. Throws when signed out.
 */
async function checkUserStart(ctx: MutationCtx): Promise<{
  userId: string;
  plan: PlanTerms | null;
  refused: SendLimited | null;
}> {
  const { _id: userId } = await requireUser(ctx);
  const plan = await getPlanTerms(ctx, userId);
  const refused =
    (await checkDictationStart(ctx, userId, plan)) ??
    (await checkSpend(ctx, userId, plan));
  return { userId, plan, refused };
}
