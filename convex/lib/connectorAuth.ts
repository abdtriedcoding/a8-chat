// The OAuth side of connectors (ADR 0003): the provider auth() signs in
// with, the fetch that only reaches a connector's pinned origins,
// revocation, and what an OAuth error from the vendor means. Metadata
// discovery is in oauthDiscovery.ts.

import {
  createMCPClient,
  MCPClientError,
  type MCPClient,
  type OAuthAuthorizationServerInformation,
  type OAuthClientInformation,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
} from "@ai-sdk/mcp";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { env, type ActionCtx } from "../_generated/server";
import {
  signInServer,
  type Connector,
  type ConnectorServer,
} from "./connectors";
import {
  authorizationServerMetadataUrls,
  authorizationServersIn,
  fetchMetadata,
  protectedResourceMetadataUrls,
} from "./oauthDiscovery";
import {
  decryptSecret,
  encryptOptionalSecret,
  type EncryptionKey,
} from "./encryption";

/** Where the vendor sends the browser back after sign-in (convex/http.ts). */
export const CALLBACK_PATH = "/connectors/callback";

/** The pendingConnects row of the sign-in that finishConnect finishes. */
type PendingConnect = Pick<
  Doc<"pendingConnects">,
  "state" | "codeVerifier" | "authorizationServer"
>;

/**
 * The `scope` to pass `auth()` when signing in: the connector's scopes, or
 * undefined so auth() asks for the ones the protected resource metadata
 * lists.
 */
export function signInScope(connector: Connector): string | undefined {
  return connector.scopes?.join(" ");
}

/**
 * The OAuth provider `@ai-sdk/mcp`'s `auth()` runs a connector's sign-in
 * with (ADR 0003). The client registration lives in oauthClientRegistrations. What
 * a sign-in produces (state, PKCE verifier, authorization server, tokens) is
 * kept on the provider for the caller to store. connect saves a
 * pendingConnects row, and finishConnect saves the connection.
 *
 * Pass `fetch` to `auth()` as `fetchFn`, so it only reaches the pinned
 * origins, and signInScope as `scope` when signing in. The provider adds
 * the connector's authorize parameters to the authorize URL.
 */
export class ConnectorOAuthProvider implements OAuthClientProvider {
  authorizationUrl?: URL;
  savedState?: string;
  savedCodeVerifier?: string;
  savedAuthorizationServer?: OAuthAuthorizationServerInformation;
  savedTokens?: OAuthTokens;
  /** Read from the token response, for a `tokenResponse` label source. */
  accountLabel?: string;

  constructor(
    private readonly ctx: ActionCtx,
    protected readonly connector: Connector,
    private readonly encryptionKey: EncryptionKey,
    /** Set when finishing a sign-in. */
    private readonly pending?: PendingConnect,
  ) {}

  get redirectUrl(): string {
    return `${env.CONVEX_SITE_URL}${CALLBACK_PATH}`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      client_name: "a8",
      client_uri: env.SITE_URL,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // auth() uses HTTP Basic whenever the client has a secret.
      token_endpoint_auth_method: "client_secret_basic",
    };
  }

  state(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  }

  saveState(state: string) {
    this.savedState = state;
  }

  storedState(): string | undefined {
    return this.pending?.state;
  }

  saveCodeVerifier(codeVerifier: string) {
    this.savedCodeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.pending) throw new Error("No sign-in in progress.");
    return this.pending.codeVerifier;
  }

  redirectToAuthorization(authorizationUrl: URL) {
    for (const [name, value] of Object.entries(
      this.connector.authorizeParams ?? {},
    )) {
      authorizationUrl.searchParams.set(name, value);
    }
    this.authorizationUrl = authorizationUrl;
  }

  saveAuthorizationServerInformation(
    information: OAuthAuthorizationServerInformation,
  ) {
    this.savedAuthorizationServer = information;
  }

  authorizationServerInformation():
    OAuthAuthorizationServerInformation | undefined {
    return this.pending?.authorizationServer;
  }

  // A sign-in always goes to the vendor's consent screen, so there are no
  // tokens to reuse or refresh.
  tokens(): OAuthTokens | undefined {
    return undefined;
  }

  saveTokens(tokens: OAuthTokens) {
    this.savedTokens = tokens;
  }

  validateAuthorizationServerURL(
    _serverUrl: string | URL,
    authorizationServerUrl: string | URL,
  ) {
    const origin = new URL(authorizationServerUrl).origin;
    if (!pinnedOrigins(this.connector).includes(origin)) {
      throw new UntrustedOriginError(
        `${this.connector.name}'s MCP server named an authorization server a8 doesn't trust: ${origin}`,
      );
    }
  }

  // Every connector registers dynamically. Without this, auth() throws
  // instead of registering again when the vendor rejects the client.
  isClientInformationDynamicallyRegistered(): boolean {
    return true;
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    return await readClientInformation(
      this.ctx,
      this.connector,
      this.encryptionKey,
    );
  }

  async saveClientInformation(information: OAuthClientInformation) {
    await this.ctx.runMutation(internal.signIns.saveOAuthClientRegistration, {
      connectorId: this.connector.id,
      clientId: information.client_id,
      encryptedClientSecret: await encryptOptionalSecret(
        this.encryptionKey,
        information.client_secret,
      ),
      clientIdIssuedAt: information.client_id_issued_at,
      clientSecretExpiresAt: information.client_secret_expires_at,
      issuer: information.issuer,
      authorizationServerUrl: information.authorization_server,
      tokenEndpoint: information.token_endpoint,
    });
  }

  // auth() calls this when the vendor rejects the client. Dropping the
  // registration makes the next sign-in register again.
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier") {
    if (scope === "all" || scope === "client") {
      await forgetOAuthClientRegistration(this.ctx, this.connector);
    }
  }

  /** pinnedFetch that also reads the account label from the code exchange. */
  fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const response = await pinnedFetch(this.connector)(input, init);
    const source = this.connector.accountLabel;
    if (
      source?.from === "tokenResponse" &&
      response.ok &&
      init?.body instanceof URLSearchParams &&
      init.body.get("grant_type") === "authorization_code"
    ) {
      const body: unknown = await response
        .clone()
        .json()
        .catch(() => undefined);
      this.accountLabel = labelAt(body, source.field);
    }
    return response;
  };
}

/**
 * fetch limited to the connector's pinned origins. The provider's
 * validateAuthorizationServerURL only sees the authorization server's URL,
 * not the endpoints its metadata names, so this refuses every other origin
 * (ADR 0003).
 */
export function pinnedFetch(connector: Connector) {
  return async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    assertPinnedOrigin(connector, input);
    // fetch would follow a redirect to an origin nobody checked. auth()'s
    // metadata discovery asks for "manual" and follows redirects itself,
    // through this function, so each hop is still checked.
    const redirect = init?.redirect === "manual" ? "manual" : "error";
    try {
      return await fetch(input, { ...init, redirect });
    } catch (error) {
      // Callers check aborts and timeouts by name, so they pass through.
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        throw error;
      }
      throw new VendorUnreachableError(connector, error);
    }
  };
}

/**
 * Thrown by pinnedFetch when a request got no answer, like when DNS or the
 * connection failed. fetch throws a TypeError for that, and auth()'s
 * metadata discovery skips a URL that fails with one, so this is a
 * TypeError too.
 */
class VendorUnreachableError extends TypeError {
  constructor(connector: Connector, cause: unknown) {
    super(`a8 couldn't reach ${connector.name}.`, { cause });
    this.name = "VendorUnreachableError";
  }
}

/**
 * Thrown when a connector's server or its metadata points a8 at an origin
 * the catalog entry doesn't pin. Either the entry is wrong or the vendor
 * moved, so trying again won't help.
 */
class UntrustedOriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UntrustedOriginError";
  }
}

/** How long opening an MCP client, including its initialize request, can take. */
const OPEN_CLIENT_TIMEOUT_MS = 15_000;

/**
 * An MCP client for one of the connector's servers, sending `accessToken`.
 * It only reaches the pinned origins. Close it when done.
 */
export async function openMcpClient(
  connector: Connector,
  server: ConnectorServer,
  accessToken: string,
): Promise<MCPClient> {
  return await createMCPClient({
    transport: {
      type: "http",
      url: server.url,
      headers: { Authorization: `Bearer ${accessToken}` },
      fetch: pinnedFetch(connector),
    },
    // A signal, not `timeout`, so the SDK's error keeps the signal's
    // TimeoutError as its cause. isVendorUnreachable checks for that.
    initializationOptions: {
      signal: AbortSignal.timeout(OPEN_CLIENT_TIMEOUT_MS),
    },
  });
}

/** An open MCP client and the server it talks to. */
export type ServerClient = { server: ConnectorServer; mcp: MCPClient };

/**
 * Opens an MCP client to each of the connector's servers, in order, and
 * passes them to `run`. Closes every client it opened once `run` ends or a
 * server fails to open.
 */
export async function withMcpClients<T>(
  connector: Connector,
  accessToken: string,
  run: (clients: ServerClient[]) => Promise<T>,
): Promise<T> {
  const clients: ServerClient[] = [];
  try {
    for (const server of connector.servers) {
      clients.push({
        server,
        mcp: await openMcpClient(connector, server, accessToken),
      });
    }
    return await run(clients);
  } finally {
    await Promise.allSettled(clients.map(async ({ mcp }) => await mcp.close()));
  }
}

/**
 * The status if an MCP client's request failed because the vendor refused
 * the access token with a 401 or a 403, or else undefined.
 */
export function refusedStatus(error: unknown): 401 | 403 | undefined {
  if (!MCPClientError.isInstance(error)) return undefined;
  const status = error.statusCode;
  return status === 401 || status === 403 ? status : undefined;
}

function assertPinnedOrigin(
  connector: Connector,
  input: string | URL | Request,
) {
  const origin = new URL(input instanceof Request ? input.url : input).origin;
  if (!pinnedOrigins(connector).includes(origin)) {
    throw new UntrustedOriginError(
      `a8 doesn't contact ${origin} for ${connector.name}.`,
    );
  }
}

function pinnedOrigins(connector: Connector): string[] {
  return connector.pinnedOrigins.map((url) => new URL(url).origin);
}

/**
 * The non-blank string at a dot path like `organization.name`, trimmed, or
 * undefined. Reads the account label from a token response, or from a label
 * tool's result (readAccountLabel).
 */
export function labelAt(data: unknown, path: string): string | undefined {
  let value = data;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Deletes the connector's client registration, so the next sign-in
 * registers again. Only for a client the vendor rejected or whose secret
 * expired.
 */
export async function forgetOAuthClientRegistration(
  ctx: ActionCtx,
  connector: Connector,
) {
  await ctx.runMutation(internal.signIns.deleteOAuthClientRegistration, {
    connectorId: connector.id,
  });
}

/**
 * What an OAuth error from the vendor means for a8:
 * - `rejectedClient`: the vendor doesn't accept a8's client registration
 *   (`invalid_client` or `unauthorized_client`). Forget it, so the next
 *   sign-in registers again.
 * - `rejectedGrant`: the vendor refused the code or refresh token
 *   (`invalid_grant`). The user has to sign in again.
 * - `other`: anything else, like an outage, a rate limit or a bug.
 *
 * Takes the error auth() threw, or an OAuth error code from a token
 * endpoint's answer.
 */
export function classifyOAuthError(
  error: unknown,
): "rejectedClient" | "rejectedGrant" | "other" {
  const code = typeof error === "string" ? error : oauthErrorCode(error);
  if (code === "invalid_client" || code === "unauthorized_client") {
    return "rejectedClient";
  }
  if (code === "invalid_grant") return "rejectedGrant";
  return "other";
}

/**
 * The OAuth error code auth() failed with, like `invalid_client`, or
 * undefined for any other error.
 */
function oauthErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  // `@ai-sdk/mcp` keeps the code on the error's class, like
  // InvalidClientError.errorCode.
  const code: unknown = (error.constructor as { errorCode?: unknown })
    .errorCode;
  return typeof code === "string" ? code : undefined;
}

/**
 * Whether a8 failed because the vendor couldn't be reached: a request got
 * no answer or timed out, an MCP request got a 5xx, or the token endpoint
 * answered `server_error`.
 */
export function isVendorUnreachable(error: unknown): boolean {
  return causes(error).some(
    (cause) =>
      cause instanceof VendorUnreachableError ||
      (cause instanceof Error && cause.name === "TimeoutError") ||
      (MCPClientError.isInstance(cause) && (cause.statusCode ?? 0) >= 500) ||
      oauthErrorCode(cause) === "server_error",
  );
}

/**
 * Whether a8 failed because the connector named an origin its catalog
 * entry doesn't pin.
 */
export function isUntrustedOrigin(error: unknown): boolean {
  return causes(error).some((cause) => cause instanceof UntrustedOriginError);
}

/** The error and the errors in its `cause` chain, at most 5 deep. */
function causes(error: unknown): unknown[] {
  const chain: unknown[] = [];
  for (
    let cause = error;
    cause !== undefined && chain.length < 5;
    cause = cause instanceof Error ? cause.cause : undefined
  ) {
    chain.push(cause);
  }
  return chain;
}

/**
 * The connector's stored client registration with its secret decrypted, or
 * undefined if there's none. The vendor rejects a client whose secret
 * expired, so a8 forgets it now. A sign-in then registers again, and a
 * refresh needs a reconnect.
 */
async function readClientInformation(
  ctx: ActionCtx,
  connector: Connector,
  encryptionKey: EncryptionKey,
): Promise<OAuthClientInformation | undefined> {
  const registration = await ctx.runQuery(
    internal.signIns.getOAuthClientRegistration,
    { connectorId: connector.id },
  );
  if (!registration) return undefined;
  if (
    registration.encryptedClientSecret !== undefined &&
    registration.clientSecretExpiresAt &&
    registration.clientSecretExpiresAt * 1000 <= Date.now()
  ) {
    await forgetOAuthClientRegistration(ctx, connector);
    return undefined;
  }
  return {
    client_id: registration.clientId,
    client_secret:
      registration.encryptedClientSecret === undefined
        ? undefined
        : await decryptSecret(
            encryptionKey,
            registration.encryptedClientSecret,
          ),
    client_id_issued_at: registration.clientIdIssuedAt,
    client_secret_expires_at: registration.clientSecretExpiresAt,
    issuer: registration.issuer,
    authorization_server: registration.authorizationServerUrl,
    token_endpoint: registration.tokenEndpoint,
  };
}

/** How long each revocation request can take before a8 gives up on it. */
const REVOKE_TIMEOUT_MS = 10_000;

/**
 * Revokes a connection's grant at the vendor (RFC 7009). It revokes the
 * refresh token when there is one, which revokes the access tokens issued
 * with it. Returns false if the vendor has no revocation endpoint or a8 has
 * no client to authenticate with. Throws if a request fails.
 */
export async function revokeConnection(
  ctx: ActionCtx,
  connector: Connector,
  encryptionKey: EncryptionKey,
  connection: Pick<
    Doc<"connections">,
    "encryptedAccessToken" | "encryptedRefreshToken"
  >,
): Promise<boolean> {
  const registration = await readClientInformation(
    ctx,
    connector,
    encryptionKey,
  );
  if (!registration) return false;
  const fetchPinned = pinnedFetch(connector);
  const endpoint = await findRevocationEndpoint(
    fetchPinned,
    registration.authorization_server ??
      (await findAuthorizationServer(fetchPinned, signInServer(connector).url)),
  );
  if (!endpoint) return false;

  const [encryptedToken, tokenTypeHint] =
    connection.encryptedRefreshToken === undefined
      ? [connection.encryptedAccessToken, "access_token"]
      : [connection.encryptedRefreshToken, "refresh_token"];
  const body = new URLSearchParams({
    token: await decryptSecret(encryptionKey, encryptedToken),
    token_type_hint: tokenTypeHint,
  });
  const headers = new Headers({
    "Content-Type": "application/x-www-form-urlencoded",
  });
  // The same client authentication auth() uses at the token endpoint.
  if (registration.client_secret) {
    headers.set(
      "Authorization",
      `Basic ${btoa(`${registration.client_id}:${registration.client_secret}`)}`,
    );
  } else {
    body.set("client_id", registration.client_id);
  }
  const response = await fetchPinned(endpoint, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `${connector.name} refused to revoke the token: ${response.status} ${await response.text()}`,
    );
  }
  return true;
}

/**
 * The first authorization server the MCP server names in its protected
 * resource metadata, or the MCP server's own origin. For a client stored
 * without its authorization server.
 */
async function findAuthorizationServer(
  fetchPinned: ReturnType<typeof pinnedFetch>,
  mcpServerUrl: string,
): Promise<string> {
  const found = await fetchMetadata(
    fetchPinned,
    protectedResourceMetadataUrls(mcpServerUrl),
    {
      // One deadline for every attempt.
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
      onAttempt: (attempt) => {
        if ("error" in attempt) {
          console.error(
            "Reading the protected resource metadata failed",
            attempt.error,
          );
        }
      },
    },
  );
  return authorizationServersIn(found?.metadata, mcpServerUrl)[0];
}

/**
 * The revocation endpoint from the authorization server's metadata, or
 * undefined if it doesn't list one. When the RFC 8414 metadata names none,
 * a8 reads the OpenID Connect discovery document too, because some vendors
 * list it only there. Throws if a8 finds no metadata.
 */
async function findRevocationEndpoint(
  fetchPinned: ReturnType<typeof pinnedFetch>,
  authorizationServerUrl: string,
): Promise<string | undefined> {
  // One deadline for every attempt.
  const signal = AbortSignal.timeout(REVOKE_TIMEOUT_MS);
  let foundMetadata = false;
  for (const url of authorizationServerMetadataUrls(authorizationServerUrl)) {
    const found = await fetchMetadata(fetchPinned, [url], { signal });
    if (!found) continue;
    foundMetadata = true;
    const endpoint = found.metadata.revocation_endpoint;
    if (typeof endpoint === "string") return endpoint;
  }
  if (!foundMetadata) {
    throw new Error(
      `Reading ${authorizationServerUrl}'s authorization server metadata failed.`,
    );
  }
  return undefined;
}
