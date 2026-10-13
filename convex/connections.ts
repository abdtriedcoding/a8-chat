// Every read and write of connections (a user's link to a connector): the
// rows, the refresh lease, disconnect and account purge, and re-encrypting
// stored secrets. All internal: convex/connectors.ts holds the public
// functions.

import { paginationOptsValidator } from "convex/server";
import { v, type Infer } from "convex/values";
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
import { requireUser } from "./lib/guards";
import { revokeConnection } from "./lib/connectorAuth";
import { REFRESH_LEASE_MS } from "./lib/connectionTokens";
import { findConnector, type Connector } from "./lib/connectors";
import {
  decryptOrUndefined,
  encryptSecret,
  getEncryptionKey,
  isLegacySecret,
} from "./lib/encryption";
import schema from "./schema";
import { deleteToolList } from "./toolLists";

/** How many of a user's connections one account cleanup step handles. */
const PURGE_CONNECTION_BATCH_SIZE = 50;

/** How many of a user's connections readUserConnections reads. */
const MAX_LISTED_CONNECTIONS = 100;

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

type ClaimRefreshResult = Infer<typeof vClaimRefreshResult>;

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

/**
 * Creates or replaces the user's connection to the connector, and schedules
 * refreshToolList to fetch its tool list.
 */
export const saveConnection = internalMutation({
  args: {
    userId: v.string(),
    connectorId: v.string(),
    encryptedAccessToken: v.string(),
    encryptedRefreshToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    accountLabel: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await findConnection(ctx, args.userId, args.connectorId);
    const now = Date.now();
    const connection = {
      ...args,
      status: "connected" as const,
      tokenVersion: (existing?.tokenVersion ?? 0) + 1,
      // Always later than the replaced row's, even within one millisecond,
      // so deleteConnection can tell a reconnect happened.
      connectedAt: Math.max(now, (existing?.connectedAt ?? 0) + 1),
    };
    let connectionId = existing?._id;
    if (connectionId) {
      await ctx.db.replace("connections", connectionId, connection);
    } else {
      connectionId = await ctx.db.insert("connections", connection);
    }
    // A reconnect keeps the row's ID, so drop the old list.
    await deleteToolList(ctx, connectionId);
    await ctx.scheduler.runAfter(0, internal.toolLists.refreshToolList, {
      connectionId,
    });
    return null;
  },
});

/**
 * Deletes the user's connection for disconnect, and returns the tokens it
 * held at that moment, so the caller can revoke tokens a refresh wrote
 * after it read them. Returns null if it deleted nothing.
 *
 * It deletes only if the row is still the user's and still has the
 * `connectedAt` disconnect read. A reconnect from another tab during
 * disconnect replaces the row with a later `connectedAt`, and that new
 * connection stays. A token refresh or a reply marking it as needing
 * reconnecting keeps `connectedAt`, so neither stops the delete.
 */
export const deleteConnection = internalMutation({
  args: {
    connectionId: v.id("connections"),
    userId: v.string(),
    connectedAt: v.number(),
  },
  returns: v.union(vConnectionTokens, v.null()),
  handler: async (ctx, { connectionId, userId, connectedAt }) => {
    const connection = await ctx.db.get("connections", connectionId);
    if (connection?.userId !== userId) return null;
    if (connection.connectedAt !== connectedAt) return null;
    return await deleteConnectionRow(ctx, connection);
  },
});

/**
 * Deletes a deleted user's connection for account purge, and returns the
 * tokens it held at that moment, like deleteConnection. It deletes only if
 * the row is the user's, whatever its `connectedAt`.
 */
export const purgeConnection = internalMutation({
  args: { connectionId: v.id("connections"), userId: v.string() },
  returns: v.union(vConnectionTokens, v.null()),
  handler: async (ctx, { connectionId, userId }) => {
    const connection = await ctx.db.get("connections", connectionId);
    if (connection?.userId !== userId) return null;
    return await deleteConnectionRow(ctx, connection);
  },
});

async function deleteConnectionRow(
  ctx: MutationCtx,
  connection: Doc<"connections">,
): Promise<ConnectionTokens> {
  await ctx.db.delete("connections", connection._id);
  await deleteToolList(ctx, connection._id);
  return connectionTokens(connection);
}

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
 *   the refresh, refused a token a8 just refreshed or answered 403, or the
 *   access token is damaged.
 * - `failed` means the vendor couldn't be reached for a refresh, or a
 *   secret was encrypted under another CONNECTION_ENCRYPTION_KEY. The
 *   tokens and the status stay.
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
 * Revokes the connection at the vendor, then deletes it with `deleteRow`,
 * even if revoking failed. Disconnect deletes with deleteConnection, and
 * account purge with purgeConnection.
 *
 * A reply may refresh the tokens between the revoke and the delete, and if
 * the vendor rotated the refresh token, revoking the old one may leave the
 * new one working. So when the deleted row's tokens changed, it revokes
 * again with those. Returns whether the last revocation worked.
 */
export async function revokeAndDeleteConnection(
  ctx: ActionCtx,
  connection: Doc<"connections">,
  deleteRow: () => Promise<ConnectionTokens | null>,
): Promise<boolean> {
  const connector = findConnector(connection.connectorId);
  let revoked = connector ? await tryRevoke(ctx, connector, connection) : false;
  const deleted = await deleteRow();
  if (
    connector &&
    deleted &&
    deleted.tokenVersion !== connection.tokenVersion
  ) {
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
        internal.connections.listUserConnections,
        { userId },
      );
      if (connections.length === 0) return null;
      for (const connection of connections) {
        await revokeAndDeleteConnection(ctx, connection, () =>
          ctx.runMutation(internal.connections.purgeConnection, {
            connectionId: connection._id,
            userId,
          }),
        );
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

/**
 * The user's connections, tokens included, in connector id order. A user has
 * at most one per connector id, but rows of connectors since removed from
 * the catalog come back too, so callers match each row to the catalog
 * themselves.
 */
export async function readUserConnections(ctx: QueryCtx, userId: string) {
  return await ctx.db
    .query("connections")
    .withIndex("by_userId_and_connectorId", (q) => q.eq("userId", userId))
    .take(MAX_LISTED_CONNECTIONS);
}

/** The user's connection to the connector, tokens included. */
async function findConnection(
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

/** How many rows one re-encrypt step reads. */
const REENCRYPT_BATCH_SIZE = 100;

/** An encrypted value stored in a connection or a client registration. */
const vStoredSecret = v.union(
  v.object({
    table: v.literal("connections"),
    id: v.id("connections"),
    field: v.union(
      v.literal("encryptedAccessToken"),
      v.literal("encryptedRefreshToken"),
    ),
    value: v.string(),
  }),
  v.object({
    table: v.literal("oauthClientRegistrations"),
    id: v.id("oauthClientRegistrations"),
    field: v.literal("encryptedClientSecret"),
    value: v.string(),
  }),
);

type StoredSecret = Infer<typeof vStoredSecret>;

/**
 * Rewrites every v1 secret in `connections` and `oauthClientRegistrations` as v2,
 * with the current key's id (lib/encryption.ts). Run it once per
 * deployment with `npx convex run connections:reencryptSecrets`. It's
 * safe to run again: later runs find no v1 values. It leaves a v1 value
 * that doesn't decrypt as it is and counts it in `failed`. Under the right
 * key that means it's damaged, and the connection asks for a reconnect
 * when it's next used.
 */
export const reencryptSecrets = internalAction({
  args: {},
  returns: v.object({ reencrypted: v.number(), failed: v.number() }),
  handler: async (ctx) => {
    const key = await getEncryptionKey();
    let reencrypted = 0;
    let failed = 0;
    for (const table of ["connections", "oauthClientRegistrations"] as const) {
      let cursor: string | null = null;
      for (;;) {
        const page: { secrets: StoredSecret[]; cursor: string | null } =
          await ctx.runQuery(internal.connections.listLegacySecrets, {
            table,
            paginationOpts: { numItems: REENCRYPT_BATCH_SIZE, cursor },
          });
        const replacements = [];
        for (const secret of page.secrets) {
          const plaintext = await decryptOrUndefined(key, secret.value);
          if (plaintext === undefined) {
            console.error(
              `Re-encrypting ${secret.table} ${secret.id} ${secret.field} failed: it doesn't decrypt.`,
            );
            failed++;
            continue;
          }
          replacements.push({
            secret,
            value: await encryptSecret(key, plaintext),
          });
        }
        if (replacements.length > 0) {
          reencrypted += await ctx.runMutation(
            internal.connections.replaceSecrets,
            { replacements },
          );
        }
        if (page.cursor === null) break;
        cursor = page.cursor;
      }
    }
    return { reencrypted, failed };
  },
});

/**
 * The v1 secrets in one page of `table`, and the cursor of the next page,
 * or null after the last.
 */
export const listLegacySecrets = internalQuery({
  args: {
    table: v.union(v.literal("connections"), v.literal("oauthClientRegistrations")),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    secrets: v.array(vStoredSecret),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { table, paginationOpts }) => {
    if (table === "connections") {
      const { page, isDone, continueCursor } = await ctx.db
        .query("connections")
        .paginate(paginationOpts);
      return {
        secrets: page.flatMap((connection) =>
          (["encryptedAccessToken", "encryptedRefreshToken"] as const).flatMap(
            (field) => {
              const value = connection[field];
              return value !== undefined && isLegacySecret(value)
                ? [{ table, id: connection._id, field, value }]
                : [];
            },
          ),
        ),
        cursor: isDone ? null : continueCursor,
      };
    }
    const { page, isDone, continueCursor } = await ctx.db
      .query("oauthClientRegistrations")
      .paginate(paginationOpts);
    return {
      secrets: page.flatMap(({ _id, encryptedClientSecret: value }) =>
        value !== undefined && isLegacySecret(value)
          ? [{ table, id: _id, field: "encryptedClientSecret" as const, value }]
          : [],
      ),
      cursor: isDone ? null : continueCursor,
    };
  },
});

/**
 * Stores each re-encrypted value, unless its field changed since it was
 * read, like after a token refresh. It keeps `tokenVersion`, since the
 * token itself is the same. Returns how many it stored.
 */
export const replaceSecrets = internalMutation({
  args: {
    replacements: v.array(
      v.object({ secret: vStoredSecret, value: v.string() }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, { replacements }) => {
    let replaced = 0;
    for (const { secret, value } of replacements) {
      if (secret.table === "connections") {
        const connection = await ctx.db.get("connections", secret.id);
        if (connection?.[secret.field] !== secret.value) continue;
        await ctx.db.patch("connections", secret.id, { [secret.field]: value });
      } else {
        const registration = await ctx.db.get("oauthClientRegistrations", secret.id);
        if (registration?.encryptedClientSecret !== secret.value) continue;
        await ctx.db.patch("oauthClientRegistrations", secret.id, {
          encryptedClientSecret: value,
        });
      }
      replaced++;
    }
    return replaced;
  },
});
