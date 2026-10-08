// MCP sign-in and tool listing, through the official MCP TypeScript SDK.
// Runs in Convex's default runtime, which forbids code generation, so the
// client validates with @cfworker/json-schema instead of the SDK's default,
// Ajv. Call it from actions only. It handles tokens in plaintext, and the
// caller seals them with the vault before saving.
// See https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * What the SDK learns and saves during a sign-in: the registered client,
 * the PKCE verifier, the tokens, and where the authorization server is.
 */
export type OAuthSession = {
  client?: OAuthClientInformationMixed;
  codeVerifier?: string;
  tokens?: OAuthTokens;
  discovery?: OAuthDiscoveryState;
};

export type { Tool };

/**
 * The SDK's auth provider, holding the session in memory. The action that
 * runs it loads the session from the vault first and saves it after.
 */
class SessionProvider implements OAuthClientProvider {
  authorizationUrl?: URL;

  constructor(
    readonly session: OAuthSession,
    private readonly redirect: string,
    private readonly stateParam?: string,
  ) {}

  get redirectUrl() {
    return this.redirect;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "a8",
      redirect_uris: [this.redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // A public client: PKCE instead of a client secret.
      token_endpoint_auth_method: "none",
    };
  }

  state() {
    if (!this.stateParam) throw new Error("This sign-in has no state.");
    return this.stateParam;
  }

  clientInformation() {
    return this.session.client;
  }

  saveClientInformation(client: OAuthClientInformationMixed) {
    this.session.client = client;
  }

  tokens() {
    return this.session.tokens;
  }

  saveTokens(tokens: OAuthTokens) {
    this.session.tokens = tokens;
  }

  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }

  saveCodeVerifier(codeVerifier: string) {
    this.session.codeVerifier = codeVerifier;
  }

  codeVerifier() {
    if (!this.session.codeVerifier) throw new Error("No PKCE verifier.");
    return this.session.codeVerifier;
  }

  discoveryState() {
    return this.session.discovery;
  }

  saveDiscoveryState(discovery: OAuthDiscoveryState) {
    this.session.discovery = discovery;
  }

  invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ) {
    if (scope === "all" || scope === "client") delete this.session.client;
    if (scope === "all" || scope === "tokens") delete this.session.tokens;
    if (scope === "all" || scope === "verifier") {
      delete this.session.codeVerifier;
    }
    if (scope === "all" || scope === "discovery") {
      delete this.session.discovery;
    }
  }
}

/** Why a server can't be signed in to. Its message is safe to show. */
export class SignInUnsupportedError extends Error {}

/**
 * Discovers the server's authorization server, registers a8 as a client,
 * and returns the URL to send the user to, with the session to keep until
 * they come back.
 */
export async function startSignIn(options: {
  serverUrl: string;
  redirectUrl: string;
  state: string;
  scope?: string;
}): Promise<{ authorizationUrl: string; session: OAuthSession }> {
  const provider = new SessionProvider({}, options.redirectUrl, options.state);
  try {
    await auth(provider, {
      serverUrl: options.serverUrl,
      scope: options.scope,
    });
  } catch (error) {
    const metadata = provider.session.discovery?.authorizationServerMetadata;
    if (metadata && !metadata.registration_endpoint) {
      throw new SignInUnsupportedError(
        "This app's sign-in needs a pre-registered client, which a8 doesn't support yet.",
      );
    }
    throw error;
  }
  if (!provider.authorizationUrl || !provider.session.client) {
    throw new Error("The server didn't ask for a sign-in.");
  }
  return {
    authorizationUrl: provider.authorizationUrl.href,
    session: provider.session,
  };
}

/** Exchanges the code the user came back with for tokens. */
export async function finishSignIn(options: {
  serverUrl: string;
  redirectUrl: string;
  authorizationCode: string;
  session: OAuthSession;
}): Promise<OAuthSession & { tokens: OAuthTokens }> {
  const provider = new SessionProvider(options.session, options.redirectUrl);
  await auth(provider, {
    serverUrl: options.serverUrl,
    authorizationCode: options.authorizationCode,
  });
  const { tokens } = provider.session;
  if (!tokens) throw new Error("The server returned no tokens.");
  return { ...provider.session, tokens };
}

/**
 * Every tool the server lists. Opens a fresh client and closes it after,
 * so nothing stays connected.
 */
export async function listTools(
  serverUrl: string,
  accessToken?: string,
): Promise<Tool[]> {
  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
    requestInit: accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
  });
  const client = new Client(
    { name: "a8", version: "1.0.0" },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );
  await client.connect(transport);
  try {
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools({ cursor });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  } finally {
    await client.close();
  }
}

/**
 * Revokes the session's tokens where the authorization server offers
 * revocation (RFC 7009), and does nothing where it doesn't. Revoking the
 * refresh token also ends the access tokens it issued on most servers, so
 * it goes first.
 */
export async function revokeTokens(session: OAuthSession): Promise<void> {
  // OpenID Connect metadata has no revocation endpoint. OAuth metadata
  // (RFC 8414) can.
  const metadata = session.discovery?.authorizationServerMetadata;
  const endpoint =
    metadata && "revocation_endpoint" in metadata
      ? metadata.revocation_endpoint
      : undefined;
  const { tokens, client } = session;
  if (!endpoint || !tokens || !client) return;
  const revoke = async (token: string, hint: string) => {
    const body = new URLSearchParams({
      token,
      token_type_hint: hint,
      client_id: client.client_id,
    });
    if (client.client_secret) body.set("client_secret", client.client_secret);
    const response = await fetch(endpoint, { method: "POST", body });
    if (!response.ok) {
      throw new Error(`Revoking failed with status ${response.status}.`);
    }
  };
  if (tokens.refresh_token) {
    await revoke(tokens.refresh_token, "refresh_token");
  }
  await revoke(tokens.access_token, "access_token");
}
