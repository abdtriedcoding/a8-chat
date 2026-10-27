"use client";

import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache/provider";
import { decodeJwt } from "jose";
import { Suspense, use, useEffect, useState, type ReactNode } from "react";
import { preconnect } from "react-dom";
import { useInBrowser } from "@/hooks/use-in-browser";
import { authClient } from "@/lib/auth-client";
import { setLocalCopyUser } from "@/lib/local-copy";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error(
    "Missing NEXT_PUBLIC_CONVEX_URL. Run `bunx convex dev` to create .env.local.",
  );
}

// Every page under this client is signed-in only. With expectAuth, queries
// wait for the first token instead of running signed out. With
// initialAuthTokenReuse, the client keeps the layout's token once the server
// accepts it, and fetches a new one shortly before it expires. Without it,
// the client fetches a second token at once and every query runs again. Both
// options are experimental in Convex, and either can be turned off alone.
// Convex's leave prompt shows while any request is in flight, so the
// composer asks only during a Send (lib/leave-warning).
const convex = new ConvexReactClient(convexUrl, {
  expectAuth: true,
  initialAuthTokenReuse: true,
  unsavedChangesWarning: false,
});

// The client opens its WebSocket on first use, which would be the first query
// after hydration. Reading the connection state opens it when this module
// runs. Queries still wait for auth. On the server there's no window, so
// nothing connects during server rendering.
if (typeof window !== "undefined") convex.connectionState();

/**
 * Renders in the layout's shell, outside the boundary that waits for the
 * token, so this module runs while the shell hydrates and the WebSocket
 * opens without waiting for the server. The preconnect lets the browser look
 * up and reach the deployment early. The call becomes a Link header, which the
 * browser reads before the HTML. The tag puts the same hint in the HTML.
 */
export function ConvexPreconnect() {
  preconnect(convex.url);
  return <link rel="preconnect" href={convex.url} />;
}

/**
 * The app under the Convex client, with `fallback` until the token is in.
 *
 * The server sends only `fallback`, and the boundary that waits for the
 * token starts once the page has hydrated. Convex queries don't run on the
 * server, so its render of the app was its loading skeletons, which showed
 * until hydration. `fallback`'s placeholders wait a moment instead, and the
 * app mounts with the device's copy of the user's data (lib/local-copy).
 */
export function ConvexClientProvider({
  children,
  tokenPromise,
  fallback,
}: {
  children: ReactNode;
  /** The layout's token read. It gives null when the server has no token. */
  tokenPromise: Promise<string | null>;
  fallback: ReactNode;
}) {
  if (!useInBrowser()) return fallback;
  return (
    <Suspense fallback={fallback}>
      <ConvexClient tokenPromise={tokenPromise}>{children}</ConvexClient>
    </Suspense>
  );
}

/** Suspends until `tokenPromise` settles. */
function ConvexClient({
  children,
  tokenPromise,
}: {
  children: ReactNode;
  tokenPromise: Promise<string | null>;
}) {
  const initialToken = use(tokenPromise);
  const auth = useSessionAuth(initialToken);
  useLocalCopyUser(initialToken);
  return (
    <ConvexProviderWithAuth client={convex} useAuth={() => auth}>
      {/* Keeps a query subscribed for 5 minutes after the last component
          using it unmounts, so a thread opened recently shows at once. */}
      <ConvexQueryCacheProvider>{children}</ConvexQueryCacheProvider>
    </ConvexProviderWithAuth>
  );
}

/**
 * Convex auth from the Better Auth session, in place of the library's
 * ConvexBetterAuthProvider. When `fetchAccessToken` changes, Convex clears
 * auth, every query loads again, and it sends a new Authenticate. The
 * library's provider changes the function when the session first loads. This
 * hook changes it only when the session ID changes to a different ID.
 * Delete it once convex/better-auth#398 is fixed (PR #431).
 */
function useSessionAuth(initialToken: string | null) {
  const { session, gone } = useBetterAuthSession();
  const sessionId = session?.session.id;
  // Read once, from the first render. A refresh of the layout passes a new
  // token, but the client has auth by then. The token's sessionId claim names
  // the session it was issued for. When the browser loads the same session,
  // nothing changes.
  const [tokenSource, setTokenSource] = useState(() => ({
    sessionId: claimsOf(initialToken).sessionId,
    fetchAccessToken: tokenFetcher(initialToken),
  }));
  if (sessionId !== undefined && sessionId !== tokenSource.sessionId) {
    setTokenSource({
      sessionId,
      // If the token had no sessionId claim, the first session to load keeps
      // the same function. A different session fetches its own token.
      fetchAccessToken:
        tokenSource.sessionId === undefined
          ? tokenSource.fetchAccessToken
          : tokenFetcher(null),
    });
  }
  return {
    // Convex authenticates on the first render without waiting for the
    // session. With no initial token, the first call fetches one. With no
    // session, that gives null, and SessionGuard sends the user to /sign-in.
    isLoading: false,
    isAuthenticated: !gone,
    fetchAccessToken: tokenSource.fetchAccessToken,
  };
}

/**
 * Returns `initialToken` until Convex asks for a fresh token, then fetches
 * one from Better Auth and returns that. With no initial token, the first
 * call fetches. Concurrent fetches share one request.
 */
function tokenFetcher(initialToken: string | null) {
  let cached = initialToken;
  let pending: Promise<string | null> | null = null;
  return async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
    if (cached && !forceRefreshToken) return cached;
    pending ??= authClient.convex
      .token({ fetchOptions: { throw: false } })
      .then(({ data }) => (cached = data?.token ?? null))
      .catch(() => (cached = null))
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}

/**
 * Tells the local copy (lib/local-copy) who's signed in, so it shows only
 * that user's data. Until the session loads, that's the user the token was
 * issued for.
 */
function useLocalCopyUser(initialToken: string | null) {
  const { session, gone } = useBetterAuthSession();
  const [tokenUserId] = useState(() => claimsOf(initialToken).userId);
  const userId = session ? session.user.id : gone ? undefined : tokenUserId;
  useEffect(() => setLocalCopyUser(userId), [userId]);
}

/**
 * The Better Auth session, and whether the server said there's none. A
 * session request that failed, from a network error or a server error,
 * says nothing either way. Treating it as signed out would drop Convex's
 * token, and every query would run again signed out, so the app would show
 * no chats and a "Sign in" link until the session loaded. The Convex token
 * still decides: if the session is really gone, the next token fetch gives
 * null and SessionGuard takes over.
 */
function useBetterAuthSession() {
  const { data: session, isPending, error } = authClient.useSession();
  return { session, gone: !isPending && session === null && error === null };
}

/**
 * The user and the Better Auth session a Convex token was issued for, from
 * its claims.
 */
function claimsOf(token: string | null): {
  userId?: string;
  sessionId?: string;
} {
  if (!token) return {};
  try {
    const { sub, sessionId } = decodeJwt(token);
    return {
      userId: sub,
      sessionId: typeof sessionId === "string" ? sessionId : undefined,
    };
  } catch {
    // Not a JWT, so there's no claim to read.
    return {};
  }
}
