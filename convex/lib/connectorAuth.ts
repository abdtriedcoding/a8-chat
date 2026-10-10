import {
  createMCPClient,
  type CallToolResult,
  type MCPClient,
  type OAuthAuthorizationServerInformation,
  type OAuthClientInformation,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
} from "@ai-sdk/mcp";
import { ConvexError } from "convex/values";
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
      throw new Error(
        `${this.connector.name}'s MCP server named an authorization server a8 doesn't trust: ${origin}`,
      );
    }
  }

  isClientInformationDynamicallyRegistered(): boolean {
    return this.connector.signIn.kind === "dynamicRegistration";
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    const { signIn } = this.connector;
    if (signIn.kind === "preRegistered") {
      const clientId = process.env[signIn.clientIdEnvVar];
      const clientSecret = process.env[signIn.clientSecretEnvVar];
      if (!clientId || !clientSecret) {
        throw new ConvexError({
          code: "MISCONFIGURED",
          message: `${this.connector.name} needs ${signIn.clientIdEnvVar} and ${signIn.clientSecretEnvVar}. Ask whoever runs this a8 to set them.`,
        });
      }
      return { client_id: clientId, client_secret: clientSecret };
    }
    const client = await this.ctx.runQuery(
      internal.connectors.getConnectorClient,
      { connectorId: this.connector.id },
    );
    if (!client) return undefined;
    return {
      client_id: client.clientId,
      client_secret:
        client.encryptedClientSecret === undefined
          ? undefined
          : await decryptSecret(this.encryptionKey, client.encryptedClientSecret),
      client_id_issued_at: client.clientIdIssuedAt,
      client_secret_expires_at: client.clientSecretExpiresAt,
      issuer: client.issuer,
      authorization_server: client.authorizationServerUrl,
      token_endpoint: client.tokenEndpoint,
    };
  }

  async saveClientInformation(information: OAuthClientInformation) {
    await this.ctx.runMutation(internal.connectors.saveConnectorClient, {
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
      await forgetConnectorClient(this.ctx, this.connector);
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
    return await fetch(input, { ...init, redirect });
  };
}

/**
 * An MCP client for the connector's server, sending `accessToken`. It only
 * reaches the pinned origins. Close it when done.
 */
export async function createConnectorClient(
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
    throw new Error(`a8 doesn't contact ${origin} for ${connector.name}.`);
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
 * registers again. Only for a client the vendor rejected.
 */
export async function forgetConnectorClient(
  ctx: ActionCtx,
  connector: Connector,
) {
  if (connector.signIn.kind !== "dynamicRegistration") return;
  await ctx.runMutation(internal.connectors.deleteConnectorClient, {
    connectorId: connector.id,
  });
}

/**
 * The OAuth error code auth() failed with, like `invalid_client`, or
 * undefined for any other error.
 */
export function oauthErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  // `@ai-sdk/mcp` keeps the code on the error's class, like
  // InvalidClientError.errorCode.
  const code: unknown = (error.constructor as { errorCode?: unknown })
    .errorCode;
  return typeof code === "string" ? code : undefined;
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
  const client = await new ConnectorOAuthProvider(
    ctx,
    connector,
    encryptionKey,
  ).clientInformation();
  if (!client) return false;
  const fetchPinned = pinnedFetch(connector);
  const endpoint = await findRevocationEndpoint(
    fetchPinned,
    client.authorization_server ??
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
  if (client.client_secret) {
    headers.set(
      "Authorization",
      `Basic ${btoa(`${client.client_id}:${client.client_secret}`)}`,
    );
  } else {
    body.set("client_id", client.client_id);
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
 * The authorization server the MCP server names in its protected resource
 * metadata (RFC 9728), or the MCP server's own origin if it names none. A
 * pre-registered client has no stored authorization server, so revocation
 * looks it up here.
 */
async function findAuthorizationServer(
  fetchPinned: ReturnType<typeof pinnedFetch>,
  mcpServerUrl: string,
): Promise<string> {
  const server = new URL(mcpServerUrl);
  const path = server.pathname === "/" ? "" : server.pathname.replace(/\/$/, "");
  // One deadline for both attempts.
  const signal = AbortSignal.timeout(REVOKE_TIMEOUT_MS);
  for (const suffix of path ? [path, ""] : [""]) {
    const response = await fetchPinned(
      new URL(`/.well-known/oauth-protected-resource${suffix}`, server.origin),
      { signal },
    ).catch((error: unknown) => {
      console.error("Reading the protected resource metadata failed", error);
      return undefined;
    });
    if (!response?.ok) continue;
    const metadata: unknown = await response.json().catch(() => undefined);
    const servers: unknown =
      typeof metadata === "object" && metadata !== null
        ? (metadata as Record<string, unknown>).authorization_servers
        : undefined;
    if (Array.isArray(servers) && typeof servers[0] === "string") {
      return servers[0];
    }
  }
  return server.origin;
}

/**
 * The revocation endpoint from the authorization server's metadata
 * (RFC 8414), or undefined if it doesn't list one.
 */
async function findRevocationEndpoint(
  fetchPinned: ReturnType<typeof pinnedFetch>,
  authorizationServerUrl: string,
): Promise<string | undefined> {
  const server = new URL(authorizationServerUrl);
  const path = server.pathname === "/" ? "" : server.pathname.replace(/\/$/, "");
  const response = await fetchPinned(
    new URL(`/.well-known/oauth-authorization-server${path}`, server.origin),
    { signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS) },
  );
  if (!response.ok) {
    throw new Error(
      `Reading the authorization server's metadata failed: ${response.status}`,
    );
  }
  const metadata: unknown = await response.json();
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const endpoint: unknown = (metadata as Record<string, unknown>)
    .revocation_endpoint;
  return typeof endpoint === "string" ? endpoint : undefined;
}
