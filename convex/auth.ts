import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import {
  APIError,
  createAuthMiddleware,
  getIp,
  isAPIError,
} from "better-auth/api";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import authConfig from "./auth.config";
import {
  addAccountEmail,
  deleteAccountEmail,
  emailIsTaken,
} from "./lib/accountEmails";
import { billingEnabled } from "./lib/billing";
import { takeDeletedUsage } from "./lib/credits";
import { EMAIL_TAKEN_MESSAGE } from "./lib/emailKey";
import { readSignInDevice, setSignInDevice } from "./lib/signInDevice";
import { checkUserName } from "./lib/userName";
import {
  checkSignIn,
  clearSignInFailures,
  countFailedSignIn,
  resetUserLimits,
  type SignInAttempt,
} from "./rateLimits";

export const authComponent = createClient<DataModel>(components.betterAuth);

function parseOrigins(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

// Queues the email in a mutation. Resend runs in the component's workpool, so
// the auth response doesn't depend on it. Auth routes run in an action, so a
// query context can't send.
async function queueEmail(
  ctx: GenericCtx<DataModel>,
  kind: "verification" | "resetPassword",
  to: string,
  url: string,
) {
  if (!("runMutation" in ctx)) return;
  await ctx.runMutation(internal.emails.sendAuthEmail, { kind, to, url });
}

// The email, client IP and device of a password sign-in, or null for other
// paths. It reads the IP the way Better Auth's own rate limit does, and the
// IP is null when Better Auth can't tell.
async function signInAttempt(
  authCtx: {
    path?: string;
    body?: { email?: unknown };
    request?: Request;
    headers?: Headers;
    context: { options: BetterAuthOptions };
  } & Parameters<typeof readSignInDevice>[0],
): Promise<SignInAttempt | null> {
  if (authCtx.path !== "/sign-in/email") return null;
  const email = authCtx.body?.email;
  if (typeof email !== "string") return null;
  const source = authCtx.request ?? authCtx.headers;
  const ip = source ? getIp(source, authCtx.context.options) : null;
  return { email, ip, device: await readSignInDevice(authCtx, email) };
}

export const createAuthOptions = (ctx: GenericCtx<DataModel>) =>
  ({
    baseURL: env.SITE_URL,
    trustedOrigins: [env.SITE_URL, ...parseOrigins(env.TRUSTED_ORIGINS)],
    secret: env.BETTER_AUTH_SECRET,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 30 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await queueEmail(ctx, "resetPassword", user.email, url);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await queueEmail(ctx, "verification", user.email, url);
      },
    },
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
        // Cancelling the subscription is awaited, so a failed cancel stops
        // the deletion and Polar never charges a deleted account.
        beforeDelete: async (user): Promise<void> => {
          const failed = new APIError("INTERNAL_SERVER_ERROR", {
            message: "Couldn't delete your account. Please try again.",
          });
          if (!("scheduler" in ctx)) throw failed;
          if (billingEnabled) {
            if (!("runAction" in ctx)) throw failed;
            try {
              await ctx.runAction(internal.billing.cancelSubscriptions, {
                userId: user.id,
              });
            } catch (error) {
              console.error("Couldn't cancel the subscription", error);
              throw failed;
            }
            // Before the user is gone, so a sign-up for the same inbox or
            // a reply's cost can't land in between.
            try {
              await ctx.runMutation(internal.usage.keepDeletedUsage, {
                userId: user.id,
                email: user.email,
              });
            } catch (error) {
              console.error("Couldn't keep the credits used", error);
              throw failed;
            }
          }
          await ctx.scheduler.runAfter(0, internal.auth.purgeAccount, {
            userId: user.id,
            email: user.email,
          });
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Runs for every sign-up, with a password or with Google. With
          // billing on, one inbox gets one account (ADR 0019). The error
          // uses Better Auth's code for an email in use, which the sign-up
          // form answers with "check your email", as for that email.
          before: async (user): Promise<void> => {
            if (!billingEnabled || !("runQuery" in ctx)) return;
            const taken = await ctx.runQuery(internal.auth.emailTaken, {
              email: user.email,
            });
            if (taken) {
              throw new APIError("UNPROCESSABLE_ENTITY", {
                message: EMAIL_TAKEN_MESSAGE,
                code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
              });
            }
          },
          after: async (user): Promise<void> => {
            if (!("runMutation" in ctx)) return;
            await ctx.runMutation(internal.auth.startAccount, {
              userId: user.id,
              email: user.email,
              createdAt: new Date(user.createdAt).getTime(),
            });
          },
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
        "/request-password-reset": { window: 60, max: 3 },
        "/send-verification-email": { window: 60, max: 3 },
      },
    },
    hooks: {
      // Refuses a password sign-in once its email has too many wrong
      // passwords from its IP, or from all IPs. A browser with the email's
      // device cookie counts its own wrong passwords in place of all IPs'
      // (rateLimits.ts).
      before: createAuthMiddleware(async (authCtx) => {
        if (
          authCtx.path === "/sign-up/email" ||
          authCtx.path === "/update-user"
        ) {
          const name: unknown = authCtx.body?.name;
          // Update-user can change other fields without the name.
          if (name === undefined && authCtx.path === "/update-user") return;
          let checked: string;
          try {
            checked = checkUserName(typeof name === "string" ? name : "");
          } catch (error) {
            throw new APIError("BAD_REQUEST", {
              message: (error as Error).message,
            });
          }
          return { context: { body: { ...authCtx.body, name: checked } } };
        }
        const attempt = await signInAttempt(authCtx);
        // Sign-ins arrive over HTTP, in an action. A query can't count.
        if (!attempt || !("runMutation" in ctx)) return;
        const retryAfter = await checkSignIn(ctx, attempt);
        if (retryAfter !== null) {
          throw new APIError("TOO_MANY_REQUESTS", {
            message: `Too many sign-in attempts. Try again in ${Math.ceil(retryAfter / 1000)}s.`,
          });
        }
      }),
      // Counts a wrong password once Better Auth has checked it, so a correct
      // password never counts. After a sign-in goes through, it clears the
      // email and IP's count and sets the email's device cookie
      // (lib/signInDevice.ts). Only INVALID_EMAIL_OR_PASSWORD counts: other
      // 401s, like a failed session write after a correct password, aren't
      // guesses. Google sign-in and password reset use other paths and stay
      // open while the limit is hit.
      after: createAuthMiddleware(async (authCtx) => {
        const attempt = await signInAttempt(authCtx);
        if (!attempt || !("runMutation" in ctx)) return;
        const returned = authCtx.context.returned;
        if (!isAPIError(returned)) {
          await clearSignInFailures(ctx, attempt);
          await setSignInDevice(authCtx, attempt.email, attempt.device);
        } else if (returned.body?.code === "INVALID_EMAIL_OR_PASSWORD") {
          await countFailedSignIn(ctx, attempt);
        }
      }),
    },
    plugins: [
      convex({
        authConfig,
        // Signs tokens with these keys instead of the jwks table's. Unset, it
        // reads the table, as auth.config.ts falls back to the JWKS URL.
        jwks: env.JWKS,
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
 * Returns Better Auth's newest signing key, for the JWKS env var. It creates
 * one if the jwks table is empty. Set it with
 * `bunx convex run auth:getLatestJwks | bunx convex env set JWKS`. If the
 * keys rotate, set JWKS again. See "Static JWKS" in the README.
 */
export const getLatestJwks = internalAction({
  args: {},
  handler: async (ctx) => await createAuth(ctx).api.getLatestJwks(),
});

/**
 * Deletes everything a8 holds for a deleted user, except what Better Auth
 * deletes itself: scheduled prompts, threads and their messages,
 * stopped-reply and deferred-tool rows, uploads and their stored files,
 * sign-ins in progress, the auto-approve warning row, preferences, credit
 * ledger rows and usage events, rate limit counters, the email key,
 * connections (revoked at the vendor first), and the Polar customer. The
 * credits used this period stay with the email key until the period ends
 * (keepDeletedUsage, which the deleteUser hook runs first). It takes the
 * user ID because the session is gone by the time it runs. Scheduled by
 * the deleteUser hook in createAuthOptions.
 *
 * It leaves the user's emails in the Resend component, which can't delete
 * by recipient. The hourly sweep (cleanUpExpiredEmails in convex/emails.ts)
 * deletes them a day after a8 queued them.
 *
 * Scheduled prompts go first, so no run fires into a thread being deleted.
 * The steps with more than a batch of rows schedule their own continuation.
 * The vendor calls go last, so a slow vendor delays nothing else.
 */
export const purgeAccount = internalAction({
  args: { userId: v.string(), email: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, email }): Promise<null> => {
    await ctx.runMutation(internal.scheduledPrompts.purgeUserScheduledPrompts, {
      userId,
    });
    await ctx.runMutation(internal.threads.purgeUserThreads, { userId });
    await ctx.runMutation(internal.attachments.cleanup.purgeUserUploads, {
      userId,
    });
    await ctx.runMutation(internal.signIns.purgeUserPendingConnects, {
      userId,
    });
    await ctx.runMutation(internal.autoApprove.purgeUserWarning, { userId });
    await ctx.runMutation(internal.models.purgeUserPreferences, { userId });
    await ctx.runMutation(internal.usage.purgeUserUsage, { userId });
    await ctx.runMutation(internal.auth.purgeAccountLimits, { userId, email });
    await ctx.runMutation(internal.auth.purgeAccountEmail, { userId });
    await ctx.runAction(internal.connections.purgeUserConnections, {
      userId,
    });
    await ctx.runAction(internal.billing.purgeCustomer, { userId });
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

export const purgeAccountEmail = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await deleteAccountEmail(ctx, userId);
    return null;
  },
});

/** emailIsTaken, for the user create hook in createAuthOptions. */
export const emailTaken = internalQuery({
  args: { email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { email }) => await emailIsTaken(ctx, email),
});

/**
 * Adds a new account's email key and, with billing on, starts it on the
 * credits a deleted account with the same key used (takeDeletedUsage).
 * Called by the user create hook in createAuthOptions.
 */
export const startAccount = internalMutation({
  args: { userId: v.string(), email: v.string(), createdAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { userId, email, createdAt }) => {
    await addAccountEmail(ctx, { userId, email });
    if (billingEnabled) {
      await takeDeletedUsage(ctx, { userId, email, createdAt });
    }
    return null;
  },
});

// Reads the user doc, not the token, so a rename shows up right away.
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;
    return { name: user.name, email: user.email, image: user.image ?? null };
  },
});
