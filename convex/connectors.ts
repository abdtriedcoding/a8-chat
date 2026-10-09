// Connecting a connector (ADR 0003) takes three steps:
// 1. The Connectors page calls connect, which returns the vendor's authorize
//    URL, and the browser goes there.
// 2. The vendor sends the browser to callback (/connectors/callback), which
//    saves the code on the sign-in's pendingConnects row and redirects to
//    the Connectors page with `?finish=<state>`.
// 3. The page calls finishConnect, which exchanges the code and stores the
//    connection.
// The exchange waits for step 3 because the callback runs on the Convex
// site and can't see who is signed in. finishConnect only finishes a
// sign-in the signed-in user started, so a stranger who sends someone their
// authorize URL can't link that person's Notion to their own account.

import { auth, type ListToolsResult } from "@ai-sdk/mcp";
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
import {
  ConnectorOAuthProvider,
  createConnectorClient,
  forgetConnectorClient,
  oauthErrorCode,
  revokeConnection,
} from "./lib/connectorAuth";
import {
  connectionAccessToken,
  REFRESH_LEASE_MS,
} from "./lib/connectionTokens";
import {
  CONNECT_ERRORS,
  CONNECTORS,
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
          handle: connector.handle,
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
    await requireIdentity(ctx);
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
 * Where the vendor sends the browser after sign-in. Saves the code on the
 * sign-in named by `state` and redirects to the Connectors page with
 * `?finish=<state>`. If the user cancelled or the vendor refused, it
 * deletes the sign-in and redirects with `?error=<ConnectError>`.
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
  const saved = await ctx.runMutation(internal.connectors.saveCallbackCode, {
    state,
    code,
    callbackIssuer: params.get("iss") ?? undefined,
  });
  return redirectToConnectors(saved ? { finish: state } : { error: "expired" });
});

/**
 * Finishes the user's sign-in named by `state`: exchanges the code, then
 * stores the encrypted tokens and the tool list. The pendingConnects row is
 * gone once this returns, whatever the result.
 */
export const finishConnect = action({
  args: { state: v.string() },
  returns: vConnectResult,
  handler: async (ctx, { state }): Promise<ConnectResult> => {
    await requireIdentity(ctx);
    const pending = await ctx.runMutation(
      internal.connectors.takePendingConnect,
      { state },
    );
    if (!pending?.code) return { error: "expired" };
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
        authorizationCode: pending.code,
        callbackState: state,
        callbackIssuer: pending.callbackIssuer,
        fetchFn: provider.fetch,
      });
      const tokens = provider.savedTokens;
      if (!tokens) throw new Error("auth() returned without tokens.");
      const toolList = await fetchToolList(connector, tokens.access_token);
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
        accountLabel: provider.accountLabel,
        toolList: JSON.stringify(toolList),
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
      tokenVersion: connection.tokenVersion,
    });
    return { revoked };
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
 * Deletes the signed-in user's connection, unless its tokens changed since
 * `tokenVersion`. A reconnect from another tab during disconnect replaces
 * the row and bumps the version, and that new connection stays.
 */
export const deleteConnection = internalMutation({
  args: { connectionId: v.id("connections"), tokenVersion: v.number() },
  returns: v.null(),
  handler: async (ctx, { connectionId, tokenVersion }) => {
    const user = await requireUser(ctx);
    const connection = await ctx.db.get("connections", connectionId);
    if (
      connection?.userId === user._id &&
      connection.tokenVersion === tokenVersion
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

/**
 * Saves the vendor's code on the sign-in named by `state`. Returns false,
 * and saves nothing, if there's no such sign-in, it has expired, or it
 * already has a code.
 */
export const saveCallbackCode = internalMutation({
  args: {
    state: v.string(),
    code: v.string(),
    callbackIssuer: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, { state, code, callbackIssuer }) => {
    const pending = await findPendingConnect(ctx, state);
    if (!pending || pending.code !== undefined) return false;
    if (pending.expiresAt <= Date.now()) {
      await ctx.db.delete("pendingConnects", pending._id);
      return false;
    }
    await ctx.db.patch("pendingConnects", pending._id, {
      code,
      callbackIssuer,
    });
    return true;
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
      connectedAt: now,
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
 * Fetches the connection's tool list again and caches it. A reply schedules
 * this when the cache is over a day old, or when the server didn't know a
 * tool the cache listed. Does nothing if the connection is gone.
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
    const token = await connectionAccessToken(ctx, connector, connection);
    if ("needsReconnect" in token) return null;
    const toolList = await fetchToolList(connector, token.accessToken);
    await ctx.runMutation(internal.connectors.saveToolList, {
      connectionId,
      toolList: JSON.stringify(toolList),
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
 * it just refreshed.
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

/** Every tool the connector's MCP server lists, across all pages. */
async function fetchToolList(
  connector: Connector,
  accessToken: string,
): Promise<ListToolsResult["tools"]> {
  const client = await createConnectorClient(connector, accessToken);
  try {
    const tools: ListToolsResult["tools"] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools({
        params: cursor === undefined ? undefined : { cursor },
      });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return tools;
  } finally {
    await client.close();
  }
}

function isRejectedClient(oauthError: string) {
  return oauthError === "invalid_client" || oauthError === "unauthorized_client";
}

function redirectToConnectors(
  result: { finish: string } | { error: ConnectError },
) {
  const url = new URL("/connectors", env.SITE_URL);
  if ("finish" in result) url.searchParams.set("finish", result.finish);
  else url.searchParams.set("error", result.error);
  return new Response(null, {
    status: 302,
    headers: { Location: url.href },
  });
}
