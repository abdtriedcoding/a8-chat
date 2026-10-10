// Every read and write of connections, sign-ins in progress
// (pendingConnects) and OAuth client registrations (connectorClients). All
// internal: convex/connectors.ts holds the public functions.

import { ConvexError, v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireUser } from "./auth";
import { limitConnectStart } from "./rateLimits";
import { revokeConnection } from "./lib/connectorAuth";
import { REFRESH_LEASE_MS } from "./lib/connectionTokens";
import { findConnector, type Connector } from "./lib/connectors";
import { getEncryptionKey } from "./lib/encryption";
import schema, { vAuthorizationServer, vClientRegistration } from "./schema";

/** How long a sign-in can take before its pendingConnects row expires. */
const PENDING_CONNECT_TTL_MS = 10 * 60 * 1000;

/** How many pendingConnects rows one cleanup step deletes. */
const CLEANUP_BATCH_SIZE = 500;

/** How many of a user's connections one account cleanup step handles. */
const PURGE_CONNECTION_BATCH_SIZE = 50;

const connectionFields = schema.tables.connections.validator.fields;

/** The token fields of a connection, which a reply keeps up to date. */
const vConnectionTokens = v.object({
  _id: v.id("connections"),
  encryptedAccessToken: connectionFields.encryptedAccessToken,
  encryptedRefreshToken: connectionFields.encryptedRefreshToken,
  tokenExpiresAt: connectionFields.tokenExpiresAt,
  tokenVersion: connectionFields.tokenVersion,
});

export type ConnectionTokens = Infer<typeof vConnectionTokens>;

const vClaimRefreshResult = v.union(
  // The caller holds the lease and refreshes these tokens.
  v.object({ kind: v.literal("claimed"), tokens: vConnectionTokens }),
  // Another reply holds the lease. Wait and claim again.
  v.object({ kind: v.literal("busy") }),
  // The tokens changed since `tokenVersion`, so these are newer. Use them.
  v.object({ kind: v.literal("changed"), tokens: vConnectionTokens }),
  // The connection is gone or needs reconnecting.
  v.object({ kind: v.literal("needsReconnect") }),
);

export type ClaimRefreshResult = Infer<typeof vClaimRefreshResult>;

// Connections

/**
 * A connection, tokens included: by ID, or the signed-in user's connection
 * to `connectorId`. Null if there's none.
 */
export const getConnection = internalQuery({
  args: {
    by: v.union(
      v.object({ connectionId: v.id("connections") }),
      v.object({ connectorId: v.string() }),
    ),
  },
  returns: v.union(schema.doc("connections"), v.null()),
  handler: async (ctx, { by }) => {
    if ("connectionId" in by) {
      return await ctx.db.get("connections", by.connectionId);
    }
    const user = await requireUser(ctx);
    return await findConnection(ctx, user._id, by.connectorId);
  },
});

/** Creates or replaces the user's connection to the connector. */
export const saveConnection = internalMutation({
  args: {
    userId: v.string(),
    connectorId: v.string(),
    encryptedAccessToken: v.string(),
    encryptedRefreshToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    accountLabel: v.optional(v.string()),
    toolList: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await findConnection(ctx, args.userId, args.connectorId);
    const now = Date.now();
    const connection = {
      ...args,
      status: "connected" as const,
      tokenVersion: (existing?.tokenVersion ?? 0) + 1,
      toolListFetchedAt: now,
      // Always later than the replaced row's, even within one millisecond,
      // so deleteConnection can tell a reconnect happened.
      connectedAt: Math.max(now, (existing?.connectedAt ?? 0) + 1),
    };
    if (existing) {
      await ctx.db.replace("connections", existing._id, connection);
    } else {
      await ctx.db.insert("connections", connection);
    }
    return null;
  },
});

/**
 * Deletes a connection and returns the tokens it held at that moment, so
 * the caller can revoke tokens a refresh wrote after it read them. Returns
 * null if it deleted nothing.
 *
 * Disconnect passes the `connectedAt` it read. Then it only deletes the
 * signed-in user's connection, and only if it wasn't replaced since. A
 * reconnect from another tab during disconnect replaces the row with a
 * later `connectedAt`, and that new connection stays. A token refresh or a
 * reply marking it as needing reconnecting keeps `connectedAt`, so neither
 * stops the delete. Account purge passes no `connectedAt`, since the user
 * is already gone.
 */
export const deleteConnection = internalMutation({
  args: {
    connectionId: v.id("connections"),
    connectedAt: v.optional(v.number()),
  },
  returns: v.union(vConnectionTokens, v.null()),
  handler: async (ctx, { connectionId, connectedAt }) => {
    const user = connectedAt === undefined ? null : await requireUser(ctx);
    const connection = await ctx.db.get("connections", connectionId);
    if (!connection) return null;
    if (
      user &&
      (connection.userId !== user._id || connection.connectedAt !== connectedAt)
    ) {
      return null;
    }
    await ctx.db.delete("connections", connectionId);
    return connectionTokens(connection);
  },
});

/**
 * Claims the lease to refresh the connection's tokens at `tokenVersion`
 * (ADR 0003). Notion rotates refresh tokens and can revoke the connection
 * if a rotated-away one is used again, so only the lease holder refreshes.
 * The holder calls settleTokens when done.
 */
export const claimRefresh = internalMutation({
  args: { connectionId: v.id("connections"), tokenVersion: v.number() },
  returns: vClaimRefreshResult,
  handler: async (
    ctx,
    { connectionId, tokenVersion },
  ): Promise<ClaimRefreshResult> => {
    const connection = await ctx.db.get("connections", connectionId);
    if (connection?.status !== "connected") return { kind: "needsReconnect" };
    if (connection.tokenVersion !== tokenVersion) {
      return { kind: "changed", tokens: connectionTokens(connection) };
    }
    const now = Date.now();
    if ((connection.refreshLeaseExpiresAt ?? 0) > now) return { kind: "busy" };
    await ctx.db.patch("connections", connectionId, {
      refreshLeaseExpiresAt: now + REFRESH_LEASE_MS,
    });
    return { kind: "claimed", tokens: connectionTokens(connection) };
  },
});

/**
 * Records what happened to the connection's tokens at `tokenVersion`, and
 * ends the refresh lease if the caller held one:
 * - `refreshed` stores the new tokens and bumps the version.
 * - `rejected` means the connection needs reconnecting. The vendor refused
 *   the refresh, refused a token a8 just refreshed or answered 403, or a8
 *   can't decrypt the access token.
 * - `failed` means the vendor couldn't be reached for a refresh. The
 *   tokens stay.
 *
 * Changes nothing if the tokens changed since `tokenVersion`, like after a
 * reconnect or another reply's refresh. Returns the connection's tokens
 * afterwards, or null once it's gone or needs reconnecting.
 */
export const settleTokens = internalMutation({
  args: {
    connectionId: v.id("connections"),
    tokenVersion: v.number(),
    outcome: v.union(
      v.object({
        kind: v.literal("refreshed"),
        encryptedAccessToken: v.string(),
        encryptedRefreshToken: v.optional(v.string()),
        tokenExpiresAt: v.optional(v.number()),
      }),
      v.object({ kind: v.literal("rejected") }),
      v.object({ kind: v.literal("failed") }),
    ),
  },
  returns: v.union(vConnectionTokens, v.null()),
  handler: async (ctx, { connectionId, tokenVersion, outcome }) => {
    const connection = await ctx.db.get("connections", connectionId);
    if (connection?.tokenVersion === tokenVersion) {
      const change =
        outcome.kind === "refreshed"
          ? {
              encryptedAccessToken: outcome.encryptedAccessToken,
              encryptedRefreshToken: outcome.encryptedRefreshToken,
              tokenExpiresAt: outcome.tokenExpiresAt,
              tokenVersion: tokenVersion + 1,
            }
          : outcome.kind === "rejected"
            ? { status: "needs_reconnect" as const }
            : {};
      await ctx.db.patch("connections", connectionId, {
        ...change,
        refreshLeaseExpiresAt: undefined,
      });
    }
    const settled = await ctx.db.get("connections", connectionId);
    return settled?.status === "connected" ? connectionTokens(settled) : null;
  },
});

/**
 * Revokes the connection at the vendor, then deletes it with
 * deleteConnection, even if revoking failed. A reply may refresh the
 * tokens between the two, and if the vendor rotated the refresh token,
 * revoking the old one may leave the new one working. So when the deleted
 * row's tokens changed, it revokes again with those. Returns whether the
 * last revocation worked. Disconnect passes `connectedAt`, account purge
 * doesn't.
 */
export async function revokeAndDeleteConnection(
  ctx: ActionCtx,
  connection: Doc<"connections">,
  connectedAt?: number,
): Promise<boolean> {
  const connector = findConnector(connection.connectorId);
  let revoked = connector
    ? await tryRevoke(ctx, connector, connection)
    : false;
  const deleted = await ctx.runMutation(
    internal.connectorStore.deleteConnection,
    { connectionId: connection._id, connectedAt },
  );
  if (connector && deleted && deleted.tokenVersion !== connection.tokenVersion) {
    revoked = await tryRevoke(ctx, connector, deleted);
  }
  return revoked;
}

/** revokeConnection, with false and a log line if it throws. */
async function tryRevoke(
  ctx: ActionCtx,
  connector: Connector,
  tokens: ConnectionTokens,
): Promise<boolean> {
  try {
    const encryptionKey = await getEncryptionKey();
    return await revokeConnection(ctx, connector, encryptionKey, tokens);
  } catch (error) {
    console.error(`Revoking a8's ${connector.name} access failed`, error);
    return false;
  }
}

/**
 * Revokes a deleted user's connections at the vendors, then deletes them
 * (revokeAndDeleteConnection). It takes the user ID, not the session, since
 * the account is already gone. Scheduled by purgeAccount (convex/auth.ts).
 */
export const purgeUserConnections = internalAction({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }): Promise<null> => {
    // Each pass deletes the connections it lists, so the loop ends.
    for (;;) {
      const connections = await ctx.runQuery(
        internal.connectorStore.listUserConnections,
        { userId },
      );
      if (connections.length === 0) return null;
      for (const connection of connections) {
        await revokeAndDeleteConnection(ctx, connection);
      }
    }
  },
});

export const listUserConnections = internalQuery({
  args: { userId: v.string() },
  returns: v.array(schema.doc("connections")),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("connections")
      .withIndex("by_userId_and_connectorId", (q) => q.eq("userId", userId))
      .take(PURGE_CONNECTION_BATCH_SIZE);
  },
});

/** The user's connection to the connector, tokens included. */
export async function findConnection(
  ctx: QueryCtx,
  userId: string,
  connectorId: string,
) {
  return await ctx.db
    .query("connections")
    .withIndex("by_userId_and_connectorId", (q) =>
      q.eq("userId", userId).eq("connectorId", connectorId),
    )
    .unique();
}

function connectionTokens(connection: Doc<"connections">): ConnectionTokens {
  return {
    _id: connection._id,
    encryptedAccessToken: connection.encryptedAccessToken,
    encryptedRefreshToken: connection.encryptedRefreshToken,
    tokenExpiresAt: connection.tokenExpiresAt,
    tokenVersion: connection.tokenVersion,
  };
}

// Sign-ins in progress

/**
 * Checks the session, then counts one sign-in start against the user's rate
 * limit. Throws if either fails.
 */
export const checkConnectStart = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if (!(await limitConnectStart(ctx, user._id))) {
      throw new ConvexError({
        code: "RATE_LIMITED",
        message: "Too many sign-in attempts. Try again in a minute.",
      });
    }
    return null;
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
        internal.connectorStore.cleanUpExpiredConnects,
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
        internal.connectorStore.purgeUserPendingConnects,
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

export const getClientRegistration = internalQuery({
  args: { connectorId: v.string() },
  returns: v.union(schema.doc("connectorClients"), v.null()),
  handler: async (ctx, { connectorId }) => {
    return await findClientRegistration(ctx, connectorId);
  },
});

/**
 * Saves the client registration a8 just made. If another sign-in
 * registered first, it throws, because this sign-in's authorize URL names
 * a client that won't be stored. Trying again uses the stored one.
 */
export const saveClientRegistration = internalMutation({
  args: vClientRegistration.fields,
  returns: v.null(),
  handler: async (ctx, registration) => {
    const existing = await findClientRegistration(
      ctx,
      registration.connectorId,
    );
    if (existing && existing.clientId !== registration.clientId) {
      throw new ConvexError({
        code: "CONNECT_FAILED",
        message: "Another sign-in was starting at the same time. Please try again.",
      });
    }
    if (existing) {
      await ctx.db.replace("connectorClients", existing._id, registration);
    } else {
      await ctx.db.insert("connectorClients", registration);
    }
    return null;
  },
});

export const deleteClientRegistration = internalMutation({
  args: { connectorId: v.string() },
  returns: v.null(),
  handler: async (ctx, { connectorId }) => {
    const registration = await findClientRegistration(ctx, connectorId);
    if (registration) {
      await ctx.db.delete("connectorClients", registration._id);
    }
    return null;
  },
});

async function findClientRegistration(ctx: QueryCtx, connectorId: string) {
  return await ctx.db
    .query("connectorClients")
    .withIndex("by_connectorId", (q) => q.eq("connectorId", connectorId))
    .unique();
}
