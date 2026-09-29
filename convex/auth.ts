import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { env, query } from "./_generated/server";
import authConfig from "./auth.config";

// Users live only in the component's `user` table. The app keeps no copy, so
// there are no triggers to keep in sync.
export const authComponent = createClient<DataModel>(components.betterAuth);

function googleProvider() {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
  const google = googleProvider();
  return {
    baseURL: env.SITE_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: authComponent.adapter(ctx),
    // No verification until there is an email sender (Resend).
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    socialProviders: google ? { google } : {},
    // Off while email is unverified: otherwise an unverified sign-up could
    // claim someone else's email and absorb their later Google sign-in.
    account: { accountLinking: { enabled: false } },
    plugins: [convex({ authConfig })],
  } satisfies BetterAuthOptions;
};

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx));

export const enabledProviders = query({
  args: {},
  returns: v.object({ google: v.boolean() }),
  handler: async () => ({ google: googleProvider() !== undefined }),
});
