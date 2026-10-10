// Connecting a connector (ADR 0003) takes three steps:
// 1. The Connectors page calls connect, which returns the vendor's authorize
//    URL, and the browser goes there.
// 2. The vendor sends the browser to callback (/connectors/callback), which
//    redirects to the Connectors page with the code in the URL fragment:
//    `#finish=<state>&code=<code>&iss=<iss>`. A fragment never reaches a
//    server or a Referer header, and callback saves nothing.
// 3. The page calls finishConnect with the state, code and issuer, which
//    exchanges the code and stores the connection.
// The exchange waits for step 3 because the callback runs on the Convex
// site and can't see who is signed in. finishConnect only finishes a
// sign-in for the signed-in user who started it. The code goes only to the
// browser that approved, so if an attacker sends a victim their authorize
// URL, the victim's session doesn't match the starter. That fails the
// sign-in and deletes it, and the attacker never sees the code.

import { auth, MCPClientError, type MCPClient } from "@ai-sdk/mcp";
import { getThreadMetadata } from "@convex-dev/agent";
import { ConvexError, v, type Infer } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  env,
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireUser } from "./auth";
import { limitConnectStart } from "./rateLimits";
import {
  ConnectorOAuthProvider,
  createConnectorClient,
  forgetConnectorClient,
  oauthErrorCode,
  readAccountLabel,
  revokeConnection,
} from "./lib/connectorAuth";
import { storedToolList, type McpTool } from "./lib/connectorToolList";
import {
  connectionAccessToken,
  REFRESH_LEASE_MS,
} from "./lib/connectionTokens";
import {
  CONNECT_ERRORS,
  CONNECTORS,
  connectorHandle,
  findConnector,
  type ConnectError,
  type Connector,
} from "./lib/connectors";
import {
  encryptOptionalSecret,
  encryptSecret,
  getEncryptionKey,
} from "./lib/encryption";
import schema, {
  vAuthorizationServer,
  vConnectionStatus,
  vConnectorClient,
} from "./schema";

/** How long a sign-in can take before its pendingConnects row expires. */
const PENDING_CONNECT_TTL_MS = 10 * 60 * 1000;

/**
 * How long after a tool list refresh is scheduled before another can be.
 * It's long enough that a vendor outage doesn't make every reply try again.
 */
const TOOL_LIST_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;

/** How many expired pendingConnects rows one cleanup run deletes. */
const CLEANUP_BATCH_SIZE = 500;

const vConnectorStatus = v.object({
  id: v.string(),
  name: v.string(),
  handle: v.string(),
  logo: v.string(),
  description: v.string(),
  examplePrompt: v.string(),
  status: v.union(vConnectionStatus, v.literal("disconnected")),
  accountLabel: v.optional(v.string()),
  connectedAt: v.optional(v.number()),
});

export type ConnectorStatus = Infer<typeof vConnectorStatus>;

const vConnectResult = v.union(
  v.object({ connected: v.string() }),
  v.object({
    error: v.union(...CONNECT_ERRORS.map((error) => v.literal(error))),
  }),
);

/** How a sign-in ended. */
export type ConnectResult = Infer<typeof vConnectResult>;

const vDisconnectResult = v.object({ revoked: v.boolean() });

export type DisconnectResult = Infer<typeof vDisconnectResult>;

/**
 * The catalog, with the user's connection status for each connector. Never
 * returns token fields.
 */
export const list = query({
  args: {},
  returns: v.array(vConnectorStatus),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return await Promise.all(
      CONNECTORS.map(async (connector): Promise<ConnectorStatus> => {
        const connection = await findConnection(ctx, user._id, connector.id);
        return {
          id: connector.id,
          name: connector.name,
          handle: connectorHandle(connector),
          logo: connector.logo,
          description: connector.description,
          examplePrompt: connector.examplePrompt,
          status: connection?.status ?? "disconnected",
          accountLabel: connection?.accountLabel,
          connectedAt: connection?.connectedAt,
        };
      }),
    );
  },
});

/**
 * Starts signing in to a connector. Returns the vendor's authorize URL for
 * the browser to go to.
 */
export const connect = action({
  args: { connectorId: v.string() },
  returns: v.string(),
  handler: async (ctx, { connectorId }): Promise<string> => {
    // Checks the session and the rate limit before any outbound fetch, since
    // discovery and client registration call the vendor.
    await ctx.runMutation(internal.connectors.checkConnectStart, {});
    const connector = findConnector(connectorId);
    if (!connector) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Unknown connector." });
    }
    // Before anything else, so a deployment without the key stores nothing.
    const encryptionKey = await getEncryptionKey();
    const provider = new ConnectorOAuthProvider(ctx, connector, encryptionKey);
    try {
      await auth(provider, {
        serverUrl: connector.mcpServerUrl,
        fetchFn: provider.fetch,
      });
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      console.error(`Starting ${connector.name} sign-in failed`, error);
      throw new ConvexError({
        code: "CONNECT_FAILED",
        message: `Couldn't start signing in to ${connector.name}. Please try again.`,
      });
    }
    const {
      authorizationUrl,
      savedState,
      savedCodeVerifier,
      savedAuthorizationServer,
    } = provider;
    if (
      !authorizationUrl ||
      !savedState ||
      !savedCodeVerifier ||
      !savedAuthorizationServer
    ) {
      throw new Error("auth() returned without starting a sign-in.");
    }
    await ctx.runMutation(internal.connectors.savePendingConnect, {
      state: savedState,
      codeVerifier: savedCodeVerifier,
      connectorId: connector.id,
      authorizationServer: {
        issuer: savedAuthorizationServer.issuer,
        authorizationServerUrl: savedAuthorizationServer.authorizationServerUrl,
        tokenEndpoint: savedAuthorizationServer.tokenEndpoint,
      },
    });
    return authorizationUrl.href;
  },
});

/**
 * Where the vendor sends the browser after sign-in. Redirects to the
 * Connectors page with `#finish=<state>&code=<code>` (and `&iss=<iss>` if
 * the vendor sent one) and saves nothing. If the user cancelled or the
 * vendor refused, it deletes the sign-in and redirects with
 * `?error=<ConnectError>`.
 */
export const callback = httpAction(async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const state = params.get("state");
  if (!state) return redirectToConnectors({ error: "expired" });

  const vendorError = params.get("error");
  if (vendorError) {
    // Anyone can put `error` in this URL, so it never drops the shared
    // client. finishConnect and auth() drop it when Notion itself rejects it.
    await ctx.runMutation(internal.connectors.deletePendingConnect, { state });
    return redirectToConnectors({
      error: vendorError === "access_denied" ? "cancelled" : "failed",
    });
  }

  const code = params.get("code");
  if (!code) return redirectToConnectors({ error: "failed" });
  return redirectToConnectors({
    finish: { state, code, iss: params.get("iss") ?? undefined },
  });
});

/**
 * Finishes the user's sign-in named by `state`: exchanges the code, then
 * stores the encrypted tokens and the tool list. `code` and `iss` come from
 * the callback's redirect. The pendingConnects row is gone once this
 * returns, whatever the result.
 */
export const finishConnect = action({
  args: { state: v.string(), code: v.string(), iss: v.optional(v.string()) },
  returns: vConnectResult,
  handler: async (ctx, { state, code, iss }): Promise<ConnectResult> => {
    // takePendingConnect checks the session before any outbound fetch.
    const pending = await ctx.runMutation(
      internal.connectors.takePendingConnect,
      { state },
    );
    if (!pending) return { error: "expired" };
    const connector = findConnector(pending.connectorId);
    if (!connector) return { error: "failed" };

    try {
      const encryptionKey = await getEncryptionKey();
      const provider = new ConnectorOAuthProvider(
        ctx,
        connector,
        encryptionKey,
        pending,
      );
      await auth(provider, {
        serverUrl: connector.mcpServerUrl,
        authorizationCode: code,
        callbackState: state,
        callbackIssuer: iss,
        fetchFn: provider.fetch,
      });
      const tokens = provider.savedTokens;
      if (!tokens) throw new Error("auth() returned without tokens.");
      const client = await createConnectorClient(connector, tokens.access_token);
      let toolList: string;
      let accountLabel = provider.accountLabel;
      try {
        toolList = await fetchToolList(connector, client);
        accountLabel ??= await readAccountLabel(connector, client);
      } finally {
        await client.close();
      }
      await ctx.runMutation(internal.connectors.saveConnection, {
        userId: pending.userId,
        connectorId: connector.id,
        encryptedAccessToken: await encryptSecret(
          encryptionKey,
          tokens.access_token,
        ),
        encryptedRefreshToken: await encryptOptionalSecret(
          encryptionKey,
          tokens.refresh_token,
        ),
        tokenExpiresAt:
          tokens.expires_in === undefined
            ? undefined
            : Date.now() + tokens.expires_in * 1000,
        accountLabel,
        toolList,
      });
      return { connected: connector.id };
    } catch (error) {
      console.error(`Finishing ${connector.name} sign-in failed`, error);
      const errorCode = oauthErrorCode(error);
      if (errorCode && isRejectedClient(errorCode)) {
        await forgetConnectorClient(ctx, connector);
      }
      return { error: "failed" };
    }
  },
});

/**
 * Disconnects the user from a connector. Revokes a8's access at the vendor
 * when the vendor supports revocation, then deletes the connection, even if
 * revocation failed. Keeps the client registration, so connecting again
 * doesn't register a8 again. Threads keep their tool-call parts.
 *
 * Returns whether a8's access was revoked at the vendor. False means the
 * vendor may still accept the token until it expires.
 */
export const disconnect = action({
  args: { connectorId: v.string() },
  returns: vDisconnectResult,
  handler: async (ctx, { connectorId }): Promise<DisconnectResult> => {
    await requireIdentity(ctx);
    const connector = findConnector(connectorId);
    if (!connector) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Unknown connector." });
    }
    const connection = await ctx.runQuery(internal.connectors.getConnection, {
      connectorId,
    });
    // Already disconnected, maybe from another tab. a8 holds no token.
    if (!connection) return { revoked: true };

    let revoked = false;
    try {
      const encryptionKey = await getEncryptionKey();
      revoked = await revokeConnection(ctx, connector, encryptionKey, connection);
    } catch (error) {
      console.error(`Revoking a8's ${connector.name} access failed`, error);
    }
    await ctx.runMutation(internal.connectors.deleteConnection, {
      connectionId: connection._id,
      connectedAt: connection.connectedAt,
    });
    return { revoked };
  },
});

/** How many of a user's connections one account cleanup step handles. */
const PURGE_CONNECTION_BATCH_SIZE = 50;

/**
 * Revokes a deleted user's connections at the vendors, then deletes them.
 * It takes the user ID, not the session, since the account is already gone.
 * Like disconnect, it deletes a connection even if revoking failed.
 * Scheduled by purgeAccount (convex/auth.ts).
 */
export const purgeUserConnections = internalAction({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }): Promise<null> => {
    const encryptionKey = await getEncryptionKey();
    // Each pass deletes the connections it lists, so the loop ends.
    for (;;) {
      const connections = await ctx.runQuery(
        internal.connectors.listUserConnections,
        { userId },
      );
      if (connections.length === 0) return null;
      for (const connection of connections) {
        const connector = findConnector(connection.connectorId);
        if (connector) {
          try {
            await revokeConnection(ctx, connector, encryptionKey, connection);
          } catch (error) {
            console.error(`Revoking a8's ${connector.name} access failed`, error);
          }
        }
        await ctx.runMutation(internal.connectors.deleteConnectionById, {
          connectionId: connection._id,
        });
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

export const deleteConnectionById = internalMutation({
  args: { connectionId: v.id("connections") },
  returns: v.null(),
  handler: async (ctx, { connectionId }) => {
    await ctx.db.delete("connections", connectionId);
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
    const pending = await ctx.db
      .query("pendingConnects")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(CLEANUP_BATCH_SIZE);
    for (const row of pending) {
      await ctx.db.delete("pendingConnects", row._id);
    }
    if (pending.length === CLEANUP_BATCH_SIZE) {
      await ctx.scheduler.runAfter(
        0,
        internal.connectors.purgeUserPendingConnects,
        { userId },
      );
    }
    return null;
  },
});

/** The signed-in user's connection to the connector, tokens included. */
export const getConnection = internalQuery({
  args: { connectorId: v.string() },
  returns: v.union(schema.doc("connections"), v.null()),
  handler: async (ctx, { connectorId }) => {
    const user = await requireUser(ctx);
    return await findConnection(ctx, user._id, connectorId);
  },
});

/**
 * Deletes the signed-in user's connection, unless it was replaced since the
 * caller read it. A reconnect from another tab during disconnect replaces the
 * row with a later `connectedAt`, and that new connection stays. A token
 * refresh or a reply marking it as needing reconnecting keeps `connectedAt`,
 * so neither stops the delete.
 */
export const deleteConnection = internalMutation({
  args: { connectionId: v.id("connections"), connectedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { connectionId, connectedAt }) => {
    const user = await requireUser(ctx);
    const connection = await ctx.db.get("connections", connectionId);
    if (
      connection?.userId === user._id &&
      connection.connectedAt === connectedAt
    ) {
      await ctx.db.delete("connections", connectionId);
    }
    return null;
  },
});

export const getConnectorClient = internalQuery({
  args: { connectorId: v.string() },
  returns: v.union(schema.doc("connectorClients"), v.null()),
  handler: async (ctx, { connectorId }) => {
    return await findConnectorClient(ctx, connectorId);
  },
});

/**
 * Saves the client a8 just registered. If another sign-in registered one
 * first, it throws, because this sign-in's authorize URL names a client
 * that won't be stored. Trying again uses the stored one.
 */
export const saveConnectorClient = internalMutation({
  args: vConnectorClient.fields,
  returns: v.null(),
  handler: async (ctx, client) => {
    const existing = await findConnectorClient(ctx, client.connectorId);
    if (existing && existing.clientId !== client.clientId) {
      throw new ConvexError({
        code: "CONNECT_FAILED",
        message: "Another sign-in was starting at the same time. Please try again.",
      });
    }
    if (existing) {
      await ctx.db.replace("connectorClients", existing._id, client);
    } else {
      await ctx.db.insert("connectorClients", client);
    }
    return null;
  },
});

export const deleteConnectorClient = internalMutation({
  args: { connectorId: v.string() },
  returns: v.null(),
  handler: async (ctx, { connectorId }) => {
    const client = await findConnectorClient(ctx, connectorId);
    if (client) await ctx.db.delete("connectorClients", client._id);
    return null;
  },
});

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
 * The connections of the thread's owner, tokens included. streamReply builds
 * the reply's tools from them. It runs from the scheduler with no signed-in
 * user, so the thread names the user.
 */
export const listReplyConnections = internalQuery({
  args: { threadId: v.string() },
  returns: v.array(schema.doc("connections")),
  handler: async (ctx, { threadId }) => {
    const thread = await getThreadMetadata(ctx, components.agent, {
      threadId,
    }).catch(() => null);
    const userId = thread?.userId;
    if (!userId) return [];
    return await ctx.db
      .query("connections")
      .withIndex("by_userId_and_connectorId", (q) => q.eq("userId", userId))
      .take(CONNECTORS.length);
  },
});

/**
 * Schedules refreshToolList for the connection, unless one was scheduled
 * in the last TOOL_LIST_REFRESH_COOLDOWN_MS. A reply calls this when the
 * cached list is over a day old, or when the server didn't know a tool the
 * list had. Replies that see the same stale list at once share one refresh.
 */
export const requestToolListRefresh = internalMutation({
  args: { connectionId: v.id("connections") },
  returns: v.null(),
  handler: async (ctx, { connectionId }) => {
    const connection = await ctx.db.get("connections", connectionId);
    if (connection?.status !== "connected") return null;
    const now = Date.now();
    const requestedAt = connection.toolListRefreshRequestedAt ?? 0;
    if (now - requestedAt < TOOL_LIST_REFRESH_COOLDOWN_MS) return null;
    await ctx.db.patch("connections", connectionId, {
      toolListRefreshRequestedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.connectors.refreshToolList, {
      connectionId,
    });
    return null;
  },
});

/**
 * Fetches the connection's tool list again and caches it. Does nothing if
 * the connection is gone. Like a tool call, a token the vendor refuses is
 * refreshed and tried once more. If the refresh is refused, or the vendor
 * refuses the new token too, the connection needs reconnecting.
 */
export const refreshToolList = internalAction({
  args: { connectionId: v.id("connections") },
  returns: v.null(),
  handler: async (ctx, { connectionId }) => {
    const connection = await ctx.runQuery(
      internal.connectors.getConnectionById,
      { connectionId },
    );
    const connector = connection && findConnector(connection.connectorId);
    if (connection?.status !== "connected" || !connector) return null;
    let token = await connectionAccessToken(ctx, connector, connection);
    if ("needsReconnect" in token) return null;
    let toolList = await listToolsWithToken(connector, token.accessToken);
    if (toolList === 401) {
      // settleRefresh marks the connection if the vendor refuses the refresh.
      token = await connectionAccessToken(ctx, connector, token.tokens, {
        refused: true,
      });
      if ("needsReconnect" in token) return null;
      toolList = await listToolsWithToken(connector, token.accessToken);
    }
    if (typeof toolList === "number") {
      // The vendor refused a token a8 just refreshed, or answered 403.
      await ctx.runMutation(internal.connectors.markNeedsReconnect, {
        connectionId,
        tokenVersion: token.tokens.tokenVersion,
      });
      return null;
    }
    await ctx.runMutation(internal.connectors.saveToolList, {
      connectionId,
      toolList,
    });
    return null;
  },
});

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

/**
 * Claims the lease to refresh the connection's tokens at `tokenVersion`
 * (ADR 0003). Notion rotates refresh tokens and can revoke the connection
 * if a rotated-away one is used again, so only the lease holder refreshes.
 * The holder calls settleRefresh when done.
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
 * Ends the refresh lease claimed at `tokenVersion`:
 * - `refreshed` stores the new tokens and bumps the version.
 * - `rejected` means the vendor refused the refresh, so the connection
 *   needs reconnecting.
 * - `failed` means the vendor couldn't be reached. The tokens stay.
 *
 * Changes nothing if the tokens changed since `tokenVersion`, like after a
 * reconnect. Returns the connection's tokens afterwards, or null once it's
 * gone or needs reconnecting.
 */
export const settleRefresh = internalMutation({
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
 * Marks the connection as needing reconnecting, unless its tokens changed
 * since `tokenVersion`. A reply calls this when the vendor refuses a token
 * it just refreshed or answers 403, and so does refreshToolList. a8 also
 * calls it when it can't decrypt the access token.
 */
export const markNeedsReconnect = internalMutation({
  args: { connectionId: v.id("connections"), tokenVersion: v.number() },
  returns: v.null(),
  handler: async (ctx, { connectionId, tokenVersion }) => {
    const connection = await ctx.db.get("connections", connectionId);
    if (connection?.tokenVersion === tokenVersion) {
      await ctx.db.patch("connections", connectionId, {
        status: "needs_reconnect",
      });
    }
    return null;
  },
});

/** A connection by ID, tokens included. */
export const getConnectionById = internalQuery({
  args: { connectionId: v.id("connections") },
  returns: v.union(schema.doc("connections"), v.null()),
  handler: async (ctx, { connectionId }) => {
    return await ctx.db.get("connections", connectionId);
  },
});

/** Caches a new tool list on the connection, if it still exists. */
export const saveToolList = internalMutation({
  args: { connectionId: v.id("connections"), toolList: v.string() },
  returns: v.null(),
  handler: async (ctx, { connectionId, toolList }) => {
    if (!(await ctx.db.get("connections", connectionId))) return null;
    await ctx.db.patch("connections", connectionId, {
      toolList,
      toolListFetchedAt: Date.now(),
    });
    return null;
  },
});

/** Deletes sign-ins that expired before anyone finished them. Run by a cron. */
export const cleanUpExpiredConnects = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("pendingConnects")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", Date.now()))
      .take(CLEANUP_BATCH_SIZE);
    for (const pending of expired) {
      await ctx.db.delete("pendingConnects", pending._id);
    }
    if (expired.length === CLEANUP_BATCH_SIZE) {
      await ctx.scheduler.runAfter(
        0,
        internal.connectors.cleanUpExpiredConnects,
        {},
      );
    }
    return null;
  },
});

async function findConnectorClient(ctx: QueryCtx, connectorId: string) {
  return await ctx.db
    .query("connectorClients")
    .withIndex("by_connectorId", (q) => q.eq("connectorId", connectorId))
    .unique();
}

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

async function findPendingConnect(ctx: QueryCtx, state: string) {
  return await ctx.db
    .query("pendingConnects")
    .withIndex("by_state", (q) => q.eq("state", state))
    .unique();
}

async function requireIdentity(ctx: ActionCtx) {
  if (!(await ctx.auth.getUserIdentity())) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "Please sign in to continue.",
    });
  }
}

/**
 * Every tool the connector's MCP server lists, across all pages, as a8
 * stores them (storedToolList).
 */
async function fetchToolList(
  connector: Connector,
  client: MCPClient,
): Promise<string> {
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools({
      params: cursor === undefined ? undefined : { cursor },
    });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return storedToolList(connector, tools);
}

/**
 * The connector's tool list (fetchToolList), read with `accessToken`.
 * Returns the status if the vendor refuses the token with a 401 or 403.
 */
async function listToolsWithToken(
  connector: Connector,
  accessToken: string,
): Promise<string | 401 | 403> {
  try {
    const client = await createConnectorClient(connector, accessToken);
    try {
      return await fetchToolList(connector, client);
    } finally {
      await client.close();
    }
  } catch (error) {
    if (MCPClientError.isInstance(error)) {
      if (error.statusCode === 401 || error.statusCode === 403) {
        return error.statusCode;
      }
    }
    throw error;
  }
}

function isRejectedClient(oauthError: string) {
  return oauthError === "invalid_client" || oauthError === "unauthorized_client";
}

function redirectToConnectors(
  result:
    | { finish: { state: string; code: string; iss?: string } }
    | { error: ConnectError },
) {
  const url = new URL("/connectors", env.SITE_URL);
  if ("finish" in result) {
    const { state, code, iss } = result.finish;
    const fragment = new URLSearchParams({ finish: state, code });
    if (iss !== undefined) fragment.set("iss", iss);
    url.hash = fragment.toString();
  } else {
    url.searchParams.set("error", result.error);
  }
  return new Response(null, {
    status: 302,
    headers: { Location: url.href },
  });
}
