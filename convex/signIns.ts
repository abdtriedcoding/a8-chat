// Every read and write of sign-ins in progress (pendingConnects) and OAuth
// client registrations (oauthClientRegistrations). All internal:
// convex/connectors.ts holds the public functions.

import { v } from "convex/values";
import { appError, ERROR_CODES } from "./lib/errors";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireUser } from "./lib/guards";
import { limitConnectStart } from "./rateLimits";
import schema, {
  vAuthorizationServer,
  vOAuthClientRegistration,
} from "./schema";

/** How long a sign-in can take before its pendingConnects row expires. */
const PENDING_CONNECT_TTL_MS = 10 * 60 * 1000;

/** How many pendingConnects rows one cleanup step deletes. */
const CLEANUP_BATCH_SIZE = 500;

/**
 * Checks the session, then counts one sign-in start against the user's rate
 * limit. Throws if either fails. Returns the user's ID.
 */
export const checkConnectStart = internalMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if (!(await limitConnectStart(ctx, user._id))) {
      throw appError(
        ERROR_CODES.RATE_LIMITED,
        "Too many connection attempts. Try again in a minute.",
      );
    }
    return user._id;
  },
});

export const savePendingConnect = internalMutation({
  args: {
    state: v.string(),
    codeVerifier: v.string(),
    connectorId: v.string(),
    authorizationServer: vAuthorizationServer,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await ctx.db.insert("pendingConnects", {
      ...args,
      userId: user._id,
      expiresAt: Date.now() + PENDING_CONNECT_TTL_MS,
    });
    return null;
  },
});

/** Deletes the sign-in named by `state`, if there is one. */
export const deletePendingConnect = internalMutation({
  args: { state: v.string() },
  returns: v.null(),
  handler: async (ctx, { state }) => {
    const pending = await findPendingConnect(ctx, state);
    if (pending) await ctx.db.delete("pendingConnects", pending._id);
    return null;
  },
});

/**
 * Deletes the sign-in named by `state` and returns it. Returns null if
 * there's none, it has expired, or another user started it.
 */
export const takePendingConnect = internalMutation({
  args: { state: v.string() },
  returns: v.union(schema.doc("pendingConnects"), v.null()),
  handler: async (ctx, { state }) => {
    const user = await requireUser(ctx);
    const pending = await findPendingConnect(ctx, state);
    if (!pending) return null;
    await ctx.db.delete("pendingConnects", pending._id);
    const usable =
      pending.userId === user._id && pending.expiresAt > Date.now();
    return usable ? pending : null;
  },
});

/** Deletes sign-ins that expired before anyone finished them. Run by a cron. */
export const cleanUpExpiredConnects = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const more = await deletePendingConnects(
      ctx,
      ctx.db
        .query("pendingConnects")
        .withIndex("by_expiresAt", (q) => q.lt("expiresAt", Date.now())),
    );
    if (more) {
      await ctx.scheduler.runAfter(
        0,
        internal.signIns.cleanUpExpiredConnects,
        {},
      );
    }
    return null;
  },
});

/**
 * Deletes a deleted user's sign-ins in progress, and schedules itself again
 * if there were more than a batch. Scheduled by purgeAccount
 * (convex/auth.ts).
 */
export const purgeUserPendingConnects = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const more = await deletePendingConnects(
      ctx,
      ctx.db
        .query("pendingConnects")
        .withIndex("by_userId", (q) => q.eq("userId", userId)),
    );
    if (more) {
      await ctx.scheduler.runAfter(
        0,
        internal.signIns.purgeUserPendingConnects,
        { userId },
      );
    }
    return null;
  },
});

/**
 * Deletes the first CLEANUP_BATCH_SIZE sign-ins the query finds. Returns
 * whether it deleted a full batch, so there may be more.
 */
async function deletePendingConnects(
  ctx: MutationCtx,
  query: { take(n: number): Promise<Doc<"pendingConnects">[]> },
): Promise<boolean> {
  const rows = await query.take(CLEANUP_BATCH_SIZE);
  for (const row of rows) {
    await ctx.db.delete("pendingConnects", row._id);
  }
  return rows.length === CLEANUP_BATCH_SIZE;
}

async function findPendingConnect(ctx: QueryCtx, state: string) {
  return await ctx.db
    .query("pendingConnects")
    .withIndex("by_state", (q) => q.eq("state", state))
    .unique();
}

// OAuth client registrations

export const getOAuthClientRegistration = internalQuery({
  args: { connectorId: v.string() },
  returns: v.union(schema.doc("oauthClientRegistrations"), v.null()),
  handler: async (ctx, { connectorId }) => {
    return await findOAuthClientRegistration(ctx, connectorId);
  },
});

/**
 * Saves the client registration a8 just made. If another sign-in
 * registered first, it throws, because this sign-in's authorize URL names
 * a client that won't be stored. Trying again uses the stored one.
 */
export const saveOAuthClientRegistration = internalMutation({
  args: vOAuthClientRegistration.fields,
  returns: v.null(),
  handler: async (ctx, registration) => {
    const existing = await findOAuthClientRegistration(
      ctx,
      registration.connectorId,
    );
    if (existing && existing.clientId !== registration.clientId) {
      throw appError(
        ERROR_CODES.CONNECT_FAILED,
        "Another sign-in was starting at the same time. Please try again.",
      );
    }
    if (existing) {
      await ctx.db.replace("oauthClientRegistrations", existing._id, registration);
    } else {
      await ctx.db.insert("oauthClientRegistrations", registration);
    }
    return null;
  },
});

export const deleteOAuthClientRegistration = internalMutation({
  args: { connectorId: v.string() },
  returns: v.null(),
  handler: async (ctx, { connectorId }) => {
    const registration = await findOAuthClientRegistration(ctx, connectorId);
    if (registration) {
      await ctx.db.delete("oauthClientRegistrations", registration._id);
    }
    return null;
  },
});

async function findOAuthClientRegistration(
  ctx: QueryCtx,
  connectorId: string,
) {
  return await ctx.db
    .query("oauthClientRegistrations")
    .withIndex("by_connectorId", (q) => q.eq("connectorId", connectorId))
    .unique();
}

/**
 * Copies every connectorClients row into oauthClientRegistrations, the
 * table's new name. Run it once per deployment with
 * `npx convex run signIns:copyConnectorClients`. It's safe to run again: a
 * connector that already has a registration keeps it. Returns how many rows
 * it copied.
 */
export const copyConnectorClients = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let copied = 0;
    const rows = await ctx.db.query("connectorClients").collect();
    for (const row of rows) {
      if (await findOAuthClientRegistration(ctx, row.connectorId)) continue;
      const registration: Partial<typeof row> = { ...row };
      delete registration._id;
      delete registration._creationTime;
      await ctx.db.insert(
        "oauthClientRegistrations",
        registration as Omit<typeof row, "_id" | "_creationTime">,
      );
      copied++;
    }
    return copied;
  },
});

/**
 * Unsets `grantedScopes` on every connection and `scope` on every pending
 * sign-in, which nothing reads any more. Run it once per deployment with
 * `npx convex run signIns:clearUnusedScopes`, then remove both fields from
 * the schema. It's safe to run again. Returns how many rows it changed.
 */
export const clearUnusedScopes = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let cleared = 0;
    for await (const row of ctx.db.query("connections")) {
      if (row.grantedScopes === undefined) continue;
      await ctx.db.patch("connections", row._id, { grantedScopes: undefined });
      cleared++;
    }
    for await (const row of ctx.db.query("pendingConnects")) {
      if (row.scope === undefined) continue;
      await ctx.db.patch("pendingConnects", row._id, { scope: undefined });
      cleared++;
    }
    return cleared;
  },
});
