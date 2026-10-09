import type {
  OAuthAuthorizationServerInformation,
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
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
  /** Read from the token response's `connector.accountLabelField`. */
  accountLabel?: string;

  constructor(
    private readonly ctx: ActionCtx,
    private readonly connector: Connector,
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
  tokens(): undefined {
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
    const pinned = new URL(this.connector.pinnedOrigins.authorizationServer);
    if (origin !== pinned.origin) {
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
    const field = this.connector.accountLabelField;
    if (
      field &&
      response.ok &&
      init?.body instanceof URLSearchParams &&
      init.body.get("grant_type") === "authorization_code"
    ) {
      const body: unknown = await response
        .clone()
        .json()
        .catch(() => undefined);
      if (typeof body === "object" && body !== null && field in body) {
        const label: unknown = (body as Record<string, unknown>)[field];
        if (typeof label === "string" && label.trim()) {
          this.accountLabel = label.trim();
        }
      }
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

function assertPinnedOrigin(
  connector: Connector,
  input: string | URL | Request,
) {
  const origin = new URL(input instanceof Request ? input.url : input).origin;
  const pinned = [
    connector.pinnedOrigins.mcpServer,
    connector.pinnedOrigins.authorizationServer,
  ].map((url) => new URL(url).origin);
  if (!pinned.includes(origin)) {
    throw new Error(`a8 doesn't contact ${origin} for ${connector.name}.`);
  }
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
