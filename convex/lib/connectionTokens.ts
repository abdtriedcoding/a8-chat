// A connection's access token, refreshed when it's about to expire or the
// vendor refused it. Refresh follows ADR 0003's lease: claimRefresh claims
// it, this action asks the vendor for new tokens, and settleTokens commits
// them only if the token version still matches. Replies that find the lease
// taken wait and read the committed tokens.

import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { ConnectionTokens } from "../connections";
import {
  REFRESH_TIMEOUT_MS,
  refreshTokens,
  refusedStatus,
  type RefreshedTokens,
} from "./connectorAuth";
import type { Connector } from "./connectors";
import {
  decryptOrUndefined,
  encryptSecret,
  getEncryptionKey,
  type EncryptionKey,
} from "./encryption";

/** How close to expiry an access token gets refreshed before it's used. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * How long a reply holds the refresh lease before another can claim it.
 * It's longer than REFRESH_TIMEOUT_MS, so a lease can't run out while its
 * refresh is still waiting on the vendor.
 */
export const REFRESH_LEASE_MS = 2 * REFRESH_TIMEOUT_MS;

/** How long a reply waits before claiming a lease another reply holds again. */
const LEASE_POLL_MS = 500;

type AccessTokenResult =
  | { accessToken: string | undefined; tokens: ConnectionTokens }
  | { needsReconnect: true };

/**
 * The connection's access token, and the tokens it came from. A connection
 * to a connector with no sign-in has none, so the token is undefined. It's
 * refreshed first when it expires within 5 minutes, or when `refused` is
 * set because the vendor just refused it. Returns `needsReconnect` when the
 * vendor refuses the refresh or the connection needs reconnecting. Damaged
 * tokens mark the connection as needing reconnecting. Throws if the vendor
 * couldn't be reached, or with MISCONFIGURED if the tokens were encrypted
 * under another key. The connection's status stays then, so putting the
 * key back makes it work again.
 */
async function connectionAccessToken(
  ctx: ActionCtx,
  connector: Connector,
  tokens: ConnectionTokens,
  { refused = false }: { refused?: boolean } = {},
): Promise<AccessTokenResult> {
  if (tokens.encryptedAccessToken === undefined) {
    return { accessToken: undefined, tokens };
  }
  const key = await getEncryptionKey();
  const fresh =
    refused || isNearExpiry(tokens)
      ? await refresh(ctx, connector, key, tokens)
      : tokens;
  if (!fresh) return { needsReconnect: true };
  const accessToken =
    fresh.encryptedAccessToken === undefined
      ? undefined
      : await decryptOrUndefined(key, fresh.encryptedAccessToken);
  if (accessToken === undefined) {
    await rejectConnection(ctx, fresh);
    return { needsReconnect: true };
  }
  return { accessToken, tokens: fresh };
}

/**
 * Runs `run` with the connection's access token, refreshed first when it
 * expires soon. If the vendor refuses the token with a 401 (`run` throws
 * an error refusedStatus recognizes), refreshes it and runs once more. A
 * 403, or a second refusal, marks the connection as needing reconnecting.
 * This is the only place a vendor refusal marks it, so a rule change like
 * the 403 one happens here. A connection with no token has nothing to
 * refresh, so a 401 marks it at once.
 *
 * Returns `needsReconnect` when the connection needs reconnecting, whether
 * that was found before, during or after `run`. Other errors from `run`
 * pass through, and so do the errors connectionAccessToken throws.
 */
export async function withAccessToken<T>(
  ctx: ActionCtx,
  connector: Connector,
  tokens: ConnectionTokens,
  run: (accessToken: string | undefined, tokens: ConnectionTokens) => Promise<T>,
): Promise<{ value: T } | { needsReconnect: true }> {
  let token = await connectionAccessToken(ctx, connector, tokens);
  if ("needsReconnect" in token) return token;
  try {
    return { value: await run(token.accessToken, token.tokens) };
  } catch (error) {
    const status = refusedStatus(error);
    if (!status) throw error;
    // A refresh keeps the token's access, so it can't fix a 403. A
    // connection with no token has nothing to refresh.
    if (status === 403 || token.accessToken === undefined) {
      await rejectConnection(ctx, token.tokens);
      return { needsReconnect: true };
    }
  }
  // The refresh marks the connection itself if the vendor refuses it.
  token = await connectionAccessToken(ctx, connector, token.tokens, {
    refused: true,
  });
  if ("needsReconnect" in token) return token;
  try {
    return { value: await run(token.accessToken, token.tokens) };
  } catch (error) {
    if (!refusedStatus(error)) throw error;
    // The vendor refused a token a8 just refreshed.
    await rejectConnection(ctx, token.tokens);
    return { needsReconnect: true };
  }
}

/** Marks the connection as needing reconnecting, unless its tokens changed. */
export async function rejectConnection(
  ctx: ActionCtx,
  tokens: ConnectionTokens,
) {
  await ctx.runMutation(internal.connections.settleTokens, {
    connectionId: tokens._id,
    tokenVersion: tokens.tokenVersion,
    outcome: { kind: "rejected" },
  });
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
  key: EncryptionKey,
  seen: ConnectionTokens,
): Promise<ConnectionTokens | null> {
  const args = { connectionId: seen._id, tokenVersion: seen.tokenVersion };
  for (;;) {
    const claim = await ctx.runMutation(
      internal.connections.claimRefresh,
      args,
    );
    if (claim.kind === "needsReconnect") return null;
    if (claim.kind === "changed") return claim.tokens;
    if (claim.kind === "claimed") break;
    // The lease runs out on its own, so this ends even if its holder died.
    await new Promise((resolve) => setTimeout(resolve, LEASE_POLL_MS));
  }

  let outcome:
    | { kind: "refreshed"; tokens: RefreshedTokens }
    | { kind: "rejected" }
    | { kind: "failed"; error: unknown };
  try {
    // A damaged refresh token can't refresh, so the user signs in again.
    const refreshToken =
      seen.encryptedRefreshToken === undefined
        ? undefined
        : await decryptOrUndefined(key, seen.encryptedRefreshToken);
    const refreshed =
      refreshToken === undefined
        ? null
        : await refreshTokens(ctx, connector, key, refreshToken, seen.resource);
    outcome = refreshed
      ? { kind: "refreshed", tokens: refreshed }
      : { kind: "rejected" };
  } catch (error) {
    // If the vendor rotated the refresh token but its answer got lost, the
    // next refresh sends the rotated-away one, and Notion may revoke the
    // connection. a8 can't tell that apart from a request that never landed.
    outcome = { kind: "failed", error };
  }
  const settled = await ctx.runMutation(internal.connections.settleTokens, {
    ...args,
    outcome:
      outcome.kind === "refreshed"
        ? {
            kind: "refreshed",
            encryptedAccessToken: await encryptSecret(
              key,
              outcome.tokens.accessToken,
            ),
            encryptedRefreshToken: await encryptSecret(
              key,
              outcome.tokens.refreshToken,
            ),
            tokenExpiresAt:
              outcome.tokens.expiresIn === undefined
                ? undefined
                : Date.now() + outcome.tokens.expiresIn * 1000,
          }
        : { kind: outcome.kind },
  });
  if (outcome.kind === "failed") throw outcome.error;
  return settled;
}
