// The OAuth side of connectors (ADR 0003): the provider auth() signs in
// with, the fetch that only reaches a connector's pinned origins, metadata
// discovery, revocation, and what an OAuth error from the vendor means.

import {
  createMCPClient,
  MCPClientError,
  type CallToolResult,
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
import type { Connector } from "./connectors";
import { decryptSecret, encryptOptionalSecret } from "./encryption";

/** Where the vendor sends the browser back after sign-in (convex/http.ts). */
export const CALLBACK_PATH = "/connectors/callback";

/** The pendingConnects row of the sign-in that finishConnect finishes. */
type PendingConnect = Pick<
  Doc<"pendingConnects">,
  "state" | "codeVerifier" | "authorizationServer"
>;

/**
 * The OAuth provider `@ai-sdk/mcp`'s `auth()` runs a connector's sign-in
 * with (ADR 0003). The client registration lives in connectorClients. What
 * a sign-in produces (state, PKCE verifier, authorization server, tokens) is
 * kept on the provider for the caller to store. connect saves a
 * pendingConnects row, and finishConnect saves the connection.
 *
 * Pass `fetch` to `auth()` as `fetchFn`, so it only reaches the pinned
 * origins.
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
    private readonly encryptionKey: CryptoKey,
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
    this.authorizationUrl = authorizationUrl;
  }

  saveAuthorizationServerInformation(
    information: OAuthAuthorizationServerInformation,
  ) {
    this.savedAuthorizationServer = information;
  }

  authorizationServerInformation():
    | OAuthAuthorizationServerInformation
    | undefined {
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

  isClientInformationDynamicallyRegistered(): boolean {
    return this.connector.signIn.kind === "dynamicRegistration";
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    const registration = await this.ctx.runQuery(
      internal.connectorStore.getClientRegistration,
      { connectorId: this.connector.id },
    );
    if (!registration) return undefined;
    // The vendor rejects a client whose secret expired, so a8 forgets it
    // now. A sign-in then registers again, and a refresh needs a reconnect.
    if (
      registration.encryptedClientSecret !== undefined &&
      registration.clientSecretExpiresAt &&
      registration.clientSecretExpiresAt * 1000 <= Date.now()
    ) {
      await forgetClientRegistration(this.ctx, this.connector);
      return undefined;
    }
    return {
      client_id: registration.clientId,
      client_secret:
        registration.encryptedClientSecret === undefined
          ? undefined
          : await decryptSecret(
              this.encryptionKey,
              registration.encryptedClientSecret,
            ),
      client_id_issued_at: registration.clientIdIssuedAt,
      client_secret_expires_at: registration.clientSecretExpiresAt,
      issuer: registration.issuer,
      authorization_server: registration.authorizationServerUrl,
      token_endpoint: registration.tokenEndpoint,
    };
  }

  async saveClientInformation(information: OAuthClientInformation) {
    await this.ctx.runMutation(internal.connectorStore.saveClientRegistration, {
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
      await forgetClientRegistration(this.ctx, this.connector);
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

/**
 * An MCP client for the connector's server, sending `accessToken`. It only
 * reaches the pinned origins. Close it when done.
 */
export async function openMcpClient(
  connector: Connector,
  accessToken: string,
): Promise<MCPClient> {
  return await createMCPClient({
    transport: {
      type: "http",
      url: connector.mcpServerUrl,
      headers: { Authorization: `Bearer ${accessToken}` },
      fetch: pinnedFetch(connector),
    },
  });
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

/** How long the account label tool can take before a8 gives up on it. */
const ACCOUNT_LABEL_TIMEOUT_MS = 15_000;

/**
 * Calls the connector's account label tool once, right after sign-in, and
 * returns the label from its result. Undefined if the connector's label
 * doesn't come from a tool, the tool isn't an allowlisted read, or the call
 * or its result fails.
 */
export async function readAccountLabel(
  connector: Connector,
  client: MCPClient,
): Promise<string | undefined> {
  const source = connector.accountLabel;
  if (source?.from !== "tool") return undefined;
  // a8 calls it without asking, so only an allowlisted read qualifies.
  const entry = connector.toolAllowlist.find((tool) => tool.name === source.tool);
  if (entry?.kind !== "read") {
    console.error(
      `${connector.name}'s account label tool ${source.tool} isn't an allowlisted read.`,
    );
    return undefined;
  }
  try {
    const result = await client.callTool({
      name: source.tool,
      arguments: source.arguments ?? {},
      options: { timeout: ACCOUNT_LABEL_TIMEOUT_MS },
    });
    if (result.isError) throw new Error(JSON.stringify(result));
    return labelAt(resultData(result), source.field);
  } catch (error) {
    console.error(`Reading the ${connector.name} account label failed`, error);
    return undefined;
  }
}

/** A tool result's structured content, or its first text part as JSON. */
function resultData(result: CallToolResult): unknown {
  if ("structuredContent" in result && result.structuredContent) {
    return result.structuredContent;
  }
  const content = "content" in result ? result.content : undefined;
  const text = Array.isArray(content)
    ? (content as Array<{ type: string; text?: unknown }>).find(
        (part) => part.type === "text" && typeof part.text === "string",
      )?.text
    : undefined;
  if (typeof text !== "string") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The non-blank string at a dot path like `organization.name`, trimmed, or
 * undefined.
 */
function labelAt(data: unknown, path: string): string | undefined {
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
export async function forgetClientRegistration(
  ctx: ActionCtx,
  connector: Connector,
) {
  await ctx.runMutation(internal.connectorStore.deleteClientRegistration, {
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

/** A JSON object from OAuth metadata. */
export type Metadata = Record<string, unknown>;

/** One request metadata discovery made, and how it went. */
export type MetadataAttempt = { url: string } & (
  | { response: Response; outcome: "found" | "notOk" | "notJson" }
  | { error: unknown }
);

/**
 * Where an MCP server's protected resource metadata may be (RFC 9728), in
 * the order an MCP client tries them: the URL from the server's
 * WWW-Authenticate challenge, the path-specific well-known URL, then the
 * root one.
 */
export function protectedResourceMetadataUrls(
  mcpServerUrl: string,
  fromChallenge?: string,
): string[] {
  const { origin, pathname } = new URL(mcpServerUrl);
  const path = pathname.replace(/\/$/, "");
  const wellKnown = `${origin}/.well-known/oauth-protected-resource`;
  return unique([fromChallenge, path && `${wellKnown}${path}`, wellKnown]);
}

/**
 * The authorization servers protected resource metadata names. Without
 * any, MCP clients fall back to the MCP server's origin.
 */
export function authorizationServersIn(
  resourceMetadata: Metadata | undefined,
  mcpServerUrl: string,
): string[] {
  const named = resourceMetadata?.authorization_servers;
  if (Array.isArray(named)) {
    const servers = named.filter((server) => typeof server === "string");
    if (servers.length > 0) return servers;
  }
  return [new URL(mcpServerUrl).origin];
}

/**
 * Where an authorization server's metadata may be, in the order an MCP
 * client tries them: RFC 8414, then OpenID Connect discovery.
 */
export function authorizationServerMetadataUrls(
  authorizationServerUrl: string,
): string[] {
  const { origin, pathname } = new URL(authorizationServerUrl);
  const path = pathname.replace(/\/$/, "");
  return unique([
    `${origin}/.well-known/oauth-authorization-server${path}`,
    `${origin}/.well-known/openid-configuration${path}`,
    path && `${origin}${path}/.well-known/openid-configuration`,
  ]);
}

/**
 * Fetches each URL in turn and returns the first JSON object, with the URL
 * and response it came from. A URL that fails, answers an error status or
 * isn't a JSON object is skipped. `onAttempt` hears how each request went.
 */
export async function fetchMetadata(
  fetchFn: (url: string, init: RequestInit) => Promise<Response>,
  urls: string[],
  {
    signal,
    onAttempt,
  }: {
    signal?: AbortSignal;
    onAttempt?: (attempt: MetadataAttempt) => void;
  } = {},
): Promise<{ metadata: Metadata; url: string; response: Response } | undefined> {
  for (const url of urls) {
    let response: Response;
    try {
      response = await fetchFn(url, {
        headers: { Accept: "application/json" },
        signal,
      });
    } catch (error) {
      onAttempt?.({ url, error });
      continue;
    }
    if (!response.ok) {
      onAttempt?.({ url, response, outcome: "notOk" });
      continue;
    }
    const metadata: unknown = await response.json().catch(() => undefined);
    if (
      typeof metadata !== "object" ||
      metadata === null ||
      Array.isArray(metadata)
    ) {
      onAttempt?.({ url, response, outcome: "notJson" });
      continue;
    }
    onAttempt?.({ url, response, outcome: "found" });
    return { metadata: metadata as Metadata, url, response };
  }
  return undefined;
}

function unique(urls: (string | undefined)[]): string[] {
  return [...new Set(urls.filter((url): url is string => Boolean(url)))];
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
  encryptionKey: CryptoKey,
  connection: Pick<
    Doc<"connections">,
    "encryptedAccessToken" | "encryptedRefreshToken"
  >,
): Promise<boolean> {
  const registration = await new ConnectorOAuthProvider(
    ctx,
    connector,
    encryptionKey,
  ).clientInformation();
  if (!registration) return false;
  const fetchPinned = pinnedFetch(connector);
  const endpoint = await findRevocationEndpoint(
    fetchPinned,
    registration.authorization_server ??
      (await findAuthorizationServer(fetchPinned, connector.mcpServerUrl)),
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
 * undefined if it doesn't list one. Throws if a8 finds no metadata.
 */
async function findRevocationEndpoint(
  fetchPinned: ReturnType<typeof pinnedFetch>,
  authorizationServerUrl: string,
): Promise<string | undefined> {
  const found = await fetchMetadata(
    fetchPinned,
    authorizationServerMetadataUrls(authorizationServerUrl),
    { signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS) },
  );
  if (!found) {
    throw new Error(
      `Reading ${authorizationServerUrl}'s authorization server metadata failed.`,
    );
  }
  const endpoint = found.metadata.revocation_endpoint;
  return typeof endpoint === "string" ? endpoint : undefined;
}
