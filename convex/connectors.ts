// A connector with no sign-in turns on in one step. connect lists its tools
// without a token and stores a connection with no tokens. Connecting any
// other connector (ADR 0003) takes three steps:
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

import { auth } from "@ai-sdk/mcp";
import { ConvexError, v, type Infer } from "convex/values";
import { appError, ERROR_CODES } from "./lib/errors";
import { internal } from "./_generated/api";
import {
  action,
  env,
  httpAction,
  query,
  type ActionCtx,
} from "./_generated/server";
import { optionalUser } from "./lib/guards";
import {
  readUserConnections,
  revokeAndDeleteConnection,
} from "./connections";
import {
  classifyOAuthError,
  ConnectorOAuthProvider,
  forgetOAuthClientRegistration,
  isUntrustedOrigin,
  isVendorUnreachable,
  signInScope,
} from "./lib/connectorAuth";
import {
  CONNECTORS,
  findConnector,
  isSetUp,
  missesScopes,
  needsSignIn,
  signInServer,
  vConnectorId,
  type Connector,
} from "./lib/connectors";
import { CONNECT_ERRORS, type ConnectError } from "./lib/connectorView";
import {
  encryptOptionalSecret,
  encryptSecret,
  getEncryptionKey,
  isMisconfigured,
} from "./lib/encryption";
import { vConnectionStatus } from "./schema";
import { readToolList } from "./toolLists";

const vConnectorStatus = v.object({
  id: vConnectorId,
  status: v.union(vConnectionStatus, v.literal("disconnected")),
  accountLabel: v.optional(v.string()),
  connectedAt: v.optional(v.number()),
  // False when the deployment lacks the connector's OAuth client env vars.
  setUp: v.boolean(),
  // True when the user unticked a scope at sign-in, so some tools don't load.
  missingScopes: v.boolean(),
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

const vConnectStart = v.union(
  v.object({ authorizationUrl: v.string() }),
  ...vConnectResult.members,
);

/**
 * What connect returns. That's the vendor's authorize URL, or how turning
 * on a connector with no sign-in ended.
 */
type ConnectStart = Infer<typeof vConnectStart>;

const vDisconnectResult = v.object({ revoked: v.boolean() });

type DisconnectResult = Infer<typeof vDisconnectResult>;

/**
 * The user's connection status for each catalog connector, in catalog
 * order. The UI takes names and logos from connectorView.ts. Never returns
 * token fields. When signed out, every connector shows as disconnected.
 * The session can end under a live query, so the query returns instead of
 * throwing.
 */
export const list = query({
  args: {},
  returns: v.array(vConnectorStatus),
  handler: async (ctx) => {
    const user = await optionalUser(ctx);
    const connections = user ? await readUserConnections(ctx, user._id) : [];
    return CONNECTORS.map((connector): ConnectorStatus => {
      const connection = connections.find(
        (row) => row.connectorId === connector.id,
      );
      return {
        id: connector.id,
        status: connection?.status ?? "disconnected",
        accountLabel: connection?.accountLabel,
        connectedAt: connection?.connectedAt,
        setUp: isSetUp(connector),
        missingScopes: missesScopes(connector, connection?.grantedScopes),
      };
    });
  },
});

/**
 * Starts signing in to a connector. Returns the vendor's authorize URL for
 * the browser to go to. A connector with no sign-in connects at once
 * (connectWithoutSignIn), and this returns how that ended.
 */
export const connect = action({
  args: { connectorId: vConnectorId },
  returns: vConnectStart,
  handler: async (ctx, { connectorId }): Promise<ConnectStart> => {
    // Checks the session and the rate limit before any outbound fetch, since
    // discovery, client registration and listing tools call the vendor.
    const userId = await ctx.runMutation(
      internal.signIns.checkConnectStart,
      {},
    );
    const connector = findConnector(connectorId);
    if (!connector) {
      throw appError(ERROR_CODES.NOT_FOUND, "Unknown connector.");
    }
    if (!isSetUp(connector)) {
      throw appError(
        ERROR_CODES.MISCONFIGURED,
        `${connector.name} isn't set up on this deployment yet.`,
      );
    }
    if (!needsSignIn(connector)) {
      return await connectWithoutSignIn(ctx, connector, userId);
    }
    // Before anything else, so a deployment without the key stores nothing.
    const encryptionKey = await getEncryptionKey();
    const provider = new ConnectorOAuthProvider(ctx, connector, encryptionKey);
    try {
      await auth(provider, {
        serverUrl: signInServer(connector).url,
        scope: signInScope(connector),
        fetchFn: provider.fetch,
      });
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      console.error(`Starting ${connector.name} sign-in failed`, error);
      throw appError(
        ERROR_CODES.CONNECT_FAILED,
        `Couldn't start signing in to ${connector.name}. Please try again.`,
      );
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
    await ctx.runMutation(internal.signIns.savePendingConnect, {
      state: savedState,
      codeVerifier: savedCodeVerifier,
      connectorId: connector.id,
      authorizationServer: {
        issuer: savedAuthorizationServer.issuer,
        authorizationServerUrl: savedAuthorizationServer.authorizationServerUrl,
        tokenEndpoint: savedAuthorizationServer.tokenEndpoint,
      },
    });
    return { authorizationUrl: authorizationUrl.href };
  },
});

/**
 * Turns on a connector with no sign-in for the user. It lists the
 * connector's tools without a token, then stores a connection with no
 * tokens and that tool list. If listing fails, it stores nothing.
 */
async function connectWithoutSignIn(
  ctx: ActionCtx,
  connector: Connector,
  userId: string,
): Promise<ConnectResult> {
  try {
    const { toolList, accountLabel } = await readToolList(
      connector,
      undefined,
      { needsLabel: true },
    );
    await ctx.runMutation(internal.connections.saveConnection, {
      userId,
      connectorId: connector.id,
      accountLabel,
      toolList,
    });
    return { connected: connector.id };
  } catch (error) {
    console.error(`Turning on ${connector.name} failed`, error);
    return { error: finishConnectError(error) };
  }
}

/**
 * Where the vendor sends the browser after sign-in. Redirects to the
 * Connectors page with `#finish=<state>&code=<code>` (and `&iss=<iss>` if
 * the vendor sent one) and saves nothing. If the user cancelled or the
 * vendor refused, it deletes the sign-in and redirects with
 * `#error=<ConnectError>`.
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
    await ctx.runMutation(internal.signIns.deletePendingConnect, {
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
 * stores the encrypted tokens. The tool list and a
 * tool-based account label follow in refreshToolList. `code` and `iss` come from the callback's redirect. The
 * pendingConnects row is gone once this returns, whatever the result.
 */
export const finishConnect = action({
  args: { state: v.string(), code: v.string(), iss: v.optional(v.string()) },
  returns: vConnectResult,
  handler: async (ctx, { state, code, iss }): Promise<ConnectResult> => {
    // takePendingConnect checks the session before any outbound fetch.
    const pending = await ctx.runMutation(
      internal.signIns.takePendingConnect,
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
        serverUrl: signInServer(connector).url,
        authorizationCode: code,
        callbackState: state,
        callbackIssuer: iss,
        fetchFn: provider.fetch,
      });
      const tokens = provider.savedTokens;
      if (!tokens) throw new Error("auth() returned without tokens.");
      // Saves right after the exchange, so a failing tool list can't drop
      // tokens the vendor already granted. saveConnection schedules the tool
      // list refresh, which also reads a tool-based account label.
      await ctx.runMutation(internal.connections.saveConnection, {
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
        resource: provider.resource,
        grantedScopes: tokens.scope?.split(" ").filter(Boolean),
        accountLabel: provider.accountLabel,
      });
      return { connected: connector.id };
    } catch (error) {
      console.error(`Finishing ${connector.name} sign-in failed`, error);
      const connectError = finishConnectError(error);
      if (connectError !== "rejected_client") return { error: connectError };
      // Signing in again can't fix a pre-registered client the vendor
      // rejected, like one with a wrong secret. The deployer has to.
      if (connector.signIn?.kind === "preRegistered") {
        return { error: "misconfigured" };
      }
      await forgetOAuthClientRegistration(ctx, connector);
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
  args: { connectorId: vConnectorId },
  returns: vDisconnectResult,
  handler: async (ctx, { connectorId }): Promise<DisconnectResult> => {
    const connector = findConnector(connectorId);
    if (!connector) {
      throw appError(ERROR_CODES.NOT_FOUND, "Unknown connector.");
    }
    const connection = await ctx.runQuery(
      internal.connections.getConnection,
      { by: { connectorId } },
    );
    // Already disconnected, maybe from another tab. a8 holds no token.
    if (!connection) return { revoked: true };
    const revoked = await revokeAndDeleteConnection(ctx, connection, () =>
      ctx.runMutation(internal.connections.deleteConnection, {
        connectionId: connection._id,
        userId: connection.userId,
        connectedAt: connection.connectedAt,
      }),
    );
    return { revoked };
  },
});

/**
 * Why finishing a sign-in, or turning on a connector with no sign-in,
 * failed. This deployment or the catalog entry is set up wrong, the vendor
 * rejected a8's client registration, the vendor refused the code because
 * it expired or was already used, or the vendor couldn't be reached.
 * Anything else is `failed`.
 */
function finishConnectError(error: unknown): ConnectError {
  if (isMisconfigured(error) || isUntrustedOrigin(error)) {
    return "misconfigured";
  }
  const oauthError = classifyOAuthError(error);
  if (oauthError === "rejectedClient") return "rejected_client";
  if (oauthError === "rejectedGrant") return "expired";
  if (isVendorUnreachable(error)) return "unreachable";
  return "failed";
}

function redirectToConnectors(
  result:
    | { finish: { state: string; code: string; iss?: string } }
    | { error: ConnectError },
) {
  const url = new URL("/connectors", env.SITE_URL);
  let fragment: URLSearchParams;
  if ("finish" in result) {
    const { state, code, iss } = result.finish;
    fragment = new URLSearchParams({ finish: state, code });
    if (iss !== undefined) fragment.set("iss", iss);
  } else {
    fragment = new URLSearchParams({ error: result.error });
  }
  url.hash = fragment.toString();
  return new Response(null, {
    status: 302,
    headers: { Location: url.href },
  });
}
