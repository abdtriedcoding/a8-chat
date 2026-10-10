import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import {
  env,
  internalAction,
  internalMutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import authConfig from "./auth.config";
import { limitSignIn, resetUserLimits } from "./rateLimits";

export const authComponent = createClient<DataModel>(components.betterAuth);

function parseOrigins(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export const createAuthOptions = (ctx: GenericCtx<DataModel>) =>
  ({
    baseURL: env.SITE_URL,
    trustedOrigins: [env.SITE_URL, ...parseOrigins(env.TRUSTED_ORIGINS)],
    secret: env.BETTER_AUTH_SECRET,
    database: authComponent.adapter(ctx),
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        // Runs before Better Auth deletes the user, and a throw stops the
        // deletion. The cleanup is scheduled, not awaited: it can take many
        // transactions, and an HTTP request can't wait for all of them.
        beforeDelete: async (user): Promise<void> => {
          if (!("scheduler" in ctx)) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Couldn't delete your account. Please try again.",
            });
          }
          await ctx.scheduler.runAfter(0, internal.auth.purgeAccount, {
            userId: user.id,
            email: user.email,
          });
        },
      },
    },
    account: {
      accountLinking: { enabled: false },
      encryptOAuthTokens: true,
    },
    // Better Auth's default is in-memory counters, on only in production.
    // Convex runs each request in a fresh isolate, so memory counts nothing.
    // The database storage uses the component's rateLimit table.
    //
    // Counts are per IP and path. If Better Auth can't read a client IP (a
    // proxy chain with several addresses and no trustedProxies), all clients
    // share one bucket per path, so the limits stay loose enough for that.
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    hooks: {
      // Limits sign-ins by email, which works without a client IP and stops
      // one IP spreading guesses over many accounts.
      before: createAuthMiddleware(async (authCtx) => {
        if (authCtx.path !== "/sign-in/email") return;
        // Sign-ins arrive over HTTP, in an action. A query can't count.
        if (!("runMutation" in ctx)) return;
        const email = authCtx.body?.email;
        if (typeof email !== "string") return;
        const retryAfter = await limitSignIn(ctx, email);
        if (retryAfter !== null) {
          throw new APIError("TOO_MANY_REQUESTS", {
            message: `Too many sign-in attempts. Try again in ${Math.ceil(retryAfter / 1000)}s.`,
          });
        }
      }),
    },
    plugins: [
      convex({
        authConfig,
        jwt: {
          definePayload: ({ user }) => ({
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            pictureUrl: user.image ?? undefined,
          }),
        },
      }),
    ],
  }) satisfies BetterAuthOptions;

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx));

/**
 * Deletes everything a8 holds for a deleted user, except what Better Auth
 * deletes itself: threads and their messages, stopped-reply and
 * deferred-tool rows, uploads and their stored files, sign-ins in progress,
 * rate limit counters, and connections (revoked at the vendor first). It
 * takes the user ID because the session is gone by the time it runs.
 * Scheduled by the deleteUser hook in createAuthOptions.
 *
 * The steps with more than a batch of rows schedule their own continuation.
 * The vendor calls go last, so a slow vendor delays nothing else.
 */
export const purgeAccount = internalAction({
  args: { userId: v.string(), email: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, email }): Promise<null> => {
    await ctx.runMutation(internal.threads.purgeUserThreads, { userId });
    await ctx.runMutation(internal.attachments.purgeUserUploads, { userId });
    await ctx.runMutation(internal.connectors.purgeUserPendingConnects, {
      userId,
    });
    await ctx.runMutation(internal.auth.purgeAccountLimits, { userId, email });
    await ctx.runAction(internal.connectors.purgeUserConnections, { userId });
    return null;
  },
});

export const purgeAccountLimits = internalMutation({
  args: { userId: v.string(), email: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, email }) => {
    await resetUserLimits(ctx, userId, email);
    return null;
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    return identity;
  },
});

export async function requireUser(ctx: QueryCtx | MutationCtx) {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "Please sign in to continue.",
    });
  }
  return user;
}
