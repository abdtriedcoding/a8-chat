// Dictation's backend, and with useDictation the only code that knows about
// Deepgram (ADR 0012). The browser streams audio straight to Deepgram, so
// a8 never sees the audio or the words. All it does is mint the token that
// opens the browser's socket. See
// https://developers.deepgram.com/reference/token-based-auth-api/grant-token
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import { action, env, internalMutation, query } from "./_generated/server";
import { appError, ERROR_CODES } from "./lib/errors";
import { requireIdentity } from "./lib/guards";
import {
  limitDictationStart,
  vRateLimited,
  type RateLimited,
} from "./rateLimits";

const DEEPGRAM_GRANT_URL = "https://api.deepgram.com/v1/auth/grant";
/**
 * How long a token can open a socket for. An open socket outlives it, so
 * this doesn't limit a dictation's length.
 */
const TOKEN_TTL_SECONDS = 30;

const grantResponse = z.object({ access_token: z.string().min(1) });

/** Whether dictation is set up. It needs the optional DEEPGRAM_API_KEY. */
export const available = query({
  args: {},
  returns: v.boolean(),
  handler: async () => Boolean(env.DEEPGRAM_API_KEY),
});

/**
 * A token that opens one Deepgram socket, for the signed-in user. Counts a
 * dictation start against the rate limits, and returns the refusal instead
 * of throwing when one is hit, like the Send mutations.
 */
export const token = action({
  args: {},
  returns: v.union(v.object({ token: v.string() }), vRateLimited),
  handler: async (ctx): Promise<{ token: string } | RateLimited> => {
    const userId = await requireIdentity(ctx);
    const apiKey = env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw appError(
        ERROR_CODES.MISCONFIGURED,
        "Dictation isn't set up on this deployment.",
      );
    }
    const refused = await ctx.runMutation(internal.dictation.countStart, {
      userId,
    });
    if (refused) return refused;

    const response = await fetch(DEEPGRAM_GRANT_URL, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
    });
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
    return { token: access_token };
  },
});

/** Counts a dictation start for `token`. */
export const countStart = internalMutation({
  args: { userId: v.string() },
  returns: v.union(vRateLimited, v.null()),
  handler: (ctx, { userId }) => limitDictationStart(ctx, userId),
});
