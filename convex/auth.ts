import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { ConvexError } from "convex/values";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import {
  env,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import authConfig from "./auth.config";
import { limitSignIn } from "./rateLimits";

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
