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
import {
  action,
  env,
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
} from "./_generated/server";
import { requireUser } from "./auth";
import { findConnection, revokeAndDeleteConnection } from "./connectorStore";
import {
  classifyOAuthError,
  ConnectorOAuthProvider,
  forgetClientRegistration,
  isUntrustedOrigin,
  isVendorUnreachable,
  openMcpClient,
  readAccountLabel,
} from "./lib/connectorAuth";
import { storedToolList, type McpTool } from "./lib/connectorToolList";
import { connectionAccessToken } from "./lib/connectionTokens";
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
import schema, { vConnectionStatus } from "./schema";

/**
 * How long after a tool list refresh is scheduled before another can be.
 * It's long enough that a vendor outage doesn't make every reply try again.
 */
const TOOL_LIST_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;

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
    await ctx.runMutation(internal.connectorStore.checkConnectStart, {});
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
    await ctx.runMutation(internal.connectorStore.savePendingConnect, {
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
    // client registration. finishConnect and auth() drop it when Notion
    // itself rejects the client.
    await ctx.runMutation(internal.connectorStore.deletePendingConnect, {
      state,
    });
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
      internal.connectorStore.takePendingConnect,
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
      const client = await openMcpClient(connector, tokens.access_token);
      let toolList: string;
      let accountLabel = provider.accountLabel;
      try {
        toolList = await fetchToolList(connector, client);
        accountLabel ??= await readAccountLabel(connector, client);
      } finally {
        await client.close();
      }
      await ctx.runMutation(internal.connectorStore.saveConnection, {
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
      const connectError = finishConnectError(error);
      if (connectError === "rejected_client") {
        await forgetClientRegistration(ctx, connector);
      }
      return { error: connectError };
    }
  },
});

/**
 * Disconnects the user from a connector. Revokes a8's access at the vendor
 * when the vendor supports revocation, then deletes the connection, even if
 * revocation failed (revokeAndDeleteConnection). Keeps the client
 * registration, so connecting again doesn't register a8 again. Threads keep
 * their tool-call parts.
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
    const connection = await ctx.runQuery(
      internal.connectorStore.getConnection,
      { by: { connectorId } },
    );
    // Already disconnected, maybe from another tab. a8 holds no token.
    if (!connection) return { revoked: true };
    const revoked = await revokeAndDeleteConnection(
      ctx,
      connection,
      connection.connectedAt,
    );
    return { revoked };
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
      internal.connectorStore.getConnection,
      { by: { connectionId } },
    );
    const connector = connection && findConnector(connection.connectorId);
    if (connection?.status !== "connected" || !connector) return null;
    let token = await connectionAccessToken(ctx, connector, connection);
    if ("needsReconnect" in token) return null;
    let toolList = await listToolsWithToken(connector, token.accessToken);
    if (toolList === 401) {
      // settleTokens marks the connection if the vendor refuses the refresh.
      token = await connectionAccessToken(ctx, connector, token.tokens, {
        refused: true,
      });
      if ("needsReconnect" in token) return null;
      toolList = await listToolsWithToken(connector, token.accessToken);
    }
    if (typeof toolList === "number") {
      // The vendor refused a token a8 just refreshed, or answered 403.
      await ctx.runMutation(internal.connectorStore.settleTokens, {
        connectionId,
        tokenVersion: token.tokens.tokenVersion,
        outcome: { kind: "rejected" },
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
    const client = await openMcpClient(connector, accessToken);
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

/**
 * Why finishing a sign-in failed: this deployment or the catalog entry is
 * set up wrong, the vendor rejected a8's client registration, or the
 * vendor couldn't be reached. Anything else is `failed`.
 */
function finishConnectError(error: unknown): ConnectError {
  if (
    (error instanceof ConvexError && error.data?.code === "MISCONFIGURED") ||
    isUntrustedOrigin(error)
  ) {
    return "misconfigured";
  }
  if (classifyOAuthError(error) === "rejectedClient") return "rejected_client";
  if (isVendorUnreachable(error)) return "unreachable";
  return "failed";
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
