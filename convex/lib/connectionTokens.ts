// A connection's access token, refreshed when it's about to expire or the
// vendor refused it. Refresh follows ADR 0003's lease: claimRefresh claims
// it, this action asks the vendor for new tokens, and settleTokens commits
// them only if the token version still matches. Replies that find the lease
// taken wait and read the committed tokens.

import { auth, type OAuthTokens } from "@ai-sdk/mcp";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { ConnectionTokens } from "../connectorStore";
import {
  classifyOAuthError,
  ConnectorOAuthProvider,
  forgetClientRegistration,
  pinnedFetch,
} from "./connectorAuth";
import type { Connector } from "./connectors";
import {
  decryptSecret,
  encryptOptionalSecret,
  encryptSecret,
  getEncryptionKey,
} from "./encryption";

/** How close to expiry an access token gets refreshed before it's used. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** How long one refresh can take, across all its requests. */
const REFRESH_TIMEOUT_MS = 30_000;

/**
 * How long a reply holds the refresh lease before another can claim it.
 * It's longer than REFRESH_TIMEOUT_MS, so a lease can't run out while its
 * refresh is still waiting on the vendor.
 */
export const REFRESH_LEASE_MS = 2 * REFRESH_TIMEOUT_MS;

/** How long a reply waits before claiming a lease another reply holds again. */
const LEASE_POLL_MS = 500;

export type AccessTokenResult =
  | { accessToken: string; tokens: ConnectionTokens }
  | { needsReconnect: true };

/**
 * The connection's access token, and the tokens it came from. It's
 * refreshed first when it expires within 5 minutes, or when `refused` is
 * set because the vendor just refused it. Returns `needsReconnect` when the
 * vendor refuses the refresh or the connection needs reconnecting. Tokens
 * a8 can't decrypt mark the connection as needing reconnecting. Throws if
 * the vendor couldn't be reached.
 */
export async function connectionAccessToken(
  ctx: ActionCtx,
  connector: Connector,
  tokens: ConnectionTokens,
  { refused = false }: { refused?: boolean } = {},
): Promise<AccessTokenResult> {
  const key = await getEncryptionKey();
  const fresh =
    refused || isNearExpiry(tokens)
      ? await refresh(ctx, connector, key, tokens)
      : tokens;
  if (!fresh) return { needsReconnect: true };
  const accessToken = await decryptOrUndefined(key, fresh.encryptedAccessToken);
  if (accessToken === undefined) {
    await ctx.runMutation(internal.connectorStore.settleTokens, {
      connectionId: fresh._id,
      tokenVersion: fresh.tokenVersion,
      outcome: { kind: "rejected" },
    });
    return { needsReconnect: true };
  }
  return { accessToken, tokens: fresh };
}

/**
 * The secret decrypted, or undefined if a8 can't decrypt it, like after
 * CONNECTION_ENCRYPTION_KEY changed.
 */
async function decryptOrUndefined(
  key: CryptoKey,
  stored: string,
): Promise<string | undefined> {
  try {
    return await decryptSecret(key, stored);
  } catch {
    return undefined;
  }
}

function isNearExpiry(tokens: ConnectionTokens): boolean {
  return (
    tokens.tokenExpiresAt !== undefined &&
    tokens.tokenExpiresAt - Date.now() < REFRESH_MARGIN_MS
  );
}

/**
 * Refreshes the tokens at `seen.tokenVersion` under the lease. If another
 * reply already refreshed them, returns its tokens instead. Returns null if
 * the connection needs reconnecting.
 */
async function refresh(
  ctx: ActionCtx,
  connector: Connector,
  key: CryptoKey,
  seen: ConnectionTokens,
): Promise<ConnectionTokens | null> {
  const args = { connectionId: seen._id, tokenVersion: seen.tokenVersion };
  for (;;) {
    const claim = await ctx.runMutation(
      internal.connectorStore.claimRefresh,
      args,
    );
    if (claim.kind === "needsReconnect") return null;
    if (claim.kind === "changed") return claim.tokens;
    if (claim.kind === "claimed") break;
    // The lease runs out on its own, so this ends even if its holder died.
    await new Promise((resolve) => setTimeout(resolve, LEASE_POLL_MS));
  }

  let outcome:
    | { kind: "refreshed"; tokens: OAuthTokens }
    | { kind: "rejected" }
    | { kind: "failed"; error: unknown };
  try {
    const refreshed = await requestTokens(ctx, connector, key, seen);
    outcome = refreshed
      ? { kind: "refreshed", tokens: refreshed }
      : { kind: "rejected" };
  } catch (error) {
    // If the vendor rotated the refresh token but its answer got lost, the
    // next refresh sends the rotated-away one, and Notion may revoke the
    // connection. a8 can't tell that apart from a request that never landed.
    outcome = { kind: "failed", error };
  }
  const settled = await ctx.runMutation(internal.connectorStore.settleTokens, {
    ...args,
    outcome:
      outcome.kind === "refreshed"
        ? {
            kind: "refreshed",
            encryptedAccessToken: await encryptSecret(
              key,
              outcome.tokens.access_token,
            ),
            encryptedRefreshToken: await encryptOptionalSecret(
              key,
              outcome.tokens.refresh_token,
            ),
            tokenExpiresAt:
              outcome.tokens.expires_in === undefined
                ? undefined
                : Date.now() + outcome.tokens.expires_in * 1000,
          }
        : { kind: outcome.kind },
  });
  if (outcome.kind === "failed") throw outcome.error;
  return settled;
}

/**
 * Trades the refresh token for new tokens at the vendor. Returns null if
 * the vendor refused the refresh token or a8's client, or a8 has no client
 * or no refresh token it can decrypt, so the user has to sign in again.
 * Throws if the vendor couldn't be reached. Only call it while holding the
 * refresh lease.
 */
async function requestTokens(
  ctx: ActionCtx,
  connector: Connector,
  key: CryptoKey,
  tokens: ConnectionTokens,
): Promise<OAuthTokens | null> {
  const refreshToken =
    tokens.encryptedRefreshToken === undefined
      ? undefined
      : await decryptOrUndefined(key, tokens.encryptedRefreshToken);
  if (refreshToken === undefined) return null;
  const provider = new RefreshOAuthProvider(ctx, connector, key, refreshToken);
  // Without a client, auth() would register one, and Notion orphans the
  // grants of earlier clients. The refresh token belongs to the lost client
  // anyway.
  if (!(await provider.clientInformation())) return null;
  let rejectedError: unknown;
  try {
    await auth(provider, {
      serverUrl: connector.mcpServerUrl,
      fetchFn: provider.fetch,
    });
  } catch (error) {
    if (classifyOAuthError(error) === "other") throw error;
    rejectedError = error;
  }
  if (provider.savedTokens) return provider.savedTokens;
  // auth() swallows some refresh errors and goes on to build a sign-in URL,
  // which a8 drops. Only an OAuth error from the vendor means the refresh
  // was refused, not a rate limit or an outage.
  const rejection = classifyOAuthError(rejectedError ?? provider.refreshError);
  if (rejection === "rejectedClient") {
    await forgetClientRegistration(ctx, connector);
  }
  if (rejection !== "other") return null;
  const { refreshError } = provider;
  throw new Error(
    `Refreshing the ${connector.name} token failed${refreshError ? `: ${refreshError}` : ""}.`,
  );
}

/**
 * The OAuth provider for refreshing a connection's tokens with `auth()`.
 * It hands auth() the refresh token, and keeps what the refresh produced
 * for the caller to store.
 */
class RefreshOAuthProvider extends ConnectorOAuthProvider {
  /** The OAuth error the token endpoint answered the refresh with. */
  refreshError?: string;
  private readonly deadline = AbortSignal.timeout(REFRESH_TIMEOUT_MS);

  constructor(
    ctx: ActionCtx,
    connector: Connector,
    encryptionKey: CryptoKey,
    private refreshToken: string | undefined,
  ) {
    super(ctx, connector, encryptionKey);
  }

  override tokens(): OAuthTokens | undefined {
    if (this.refreshToken === undefined) return undefined;
    // auth() only reads the refresh token.
    return {
      access_token: "",
      token_type: "Bearer",
      refresh_token: this.refreshToken,
    };
  }

  // auth() calls this when the vendor refuses the refresh token or the
  // client, then tries again. Dropping the refresh token keeps it from
  // sending a refused one twice. The client stays, because auth() would
  // register a new one on the second try. requestTokens drops it after.
  override async invalidateCredentials() {
    this.refreshToken = undefined;
  }

  override fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const response = await pinnedFetch(this.connector)(input, {
      ...init,
      signal: init?.signal ?? this.deadline,
    });
    if (
      !response.ok &&
      init?.body instanceof URLSearchParams &&
      init.body.get("grant_type") === "refresh_token"
    ) {
      const body: unknown = await response
        .clone()
        .json()
        .catch(() => undefined);
      const error =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>).error
          : undefined;
      if (typeof error === "string") this.refreshError = error;
    }
    return response;
  };
}
