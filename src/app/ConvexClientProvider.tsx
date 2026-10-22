"use client";

import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache/provider";
import { decodeJwt } from "jose";
import { use, useState, type ReactNode } from "react";
import { preconnect } from "react-dom";
import { authClient } from "@/lib/auth-client";

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
const convex = new ConvexReactClient(convexUrl, {
  expectAuth: true,
  initialAuthTokenReuse: true,
});

// The client opens its WebSocket on first use, which would be the first query
// after hydration. Reading the connection state opens it when this module
// runs. Queries still wait for auth. On the server there's no window, so
// nothing connects during server rendering.
if (typeof window !== "undefined") convex.connectionState();

/**
 * Renders in the layout's shell, outside the Suspense boundary that waits for
 * the token, so this module runs while the shell hydrates and the WebSocket
 * opens without waiting for the server. The preconnect lets the browser look
 * up and reach the deployment early. The call becomes a Link header, which the
 * browser reads before the HTML. The tag puts the same hint in the HTML.
 */
export function ConvexPreconnect() {
  preconnect(convex.url);
  return <link rel="preconnect" href={convex.url} />;
}

export function ConvexClientProvider({
  children,
  tokenPromise,
}: {
  children: ReactNode;
  /**
   * The layout's token read. This suspends until it settles. It gives null
   * when the server has no token.
   */
  tokenPromise: Promise<string | null>;
}) {
  const auth = useSessionAuth(use(tokenPromise));
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
  const { data: session, isPending } = authClient.useSession();
  const sessionId = session?.session.id;
  // Read once, from the first render. A refresh of the layout passes a new
  // token, but the client has auth by then. The token's sessionId claim names
  // the session it was issued for. When the browser loads the same session,
  // nothing changes.
  const [tokenSource, setTokenSource] = useState(() => ({
    sessionId: sessionIdOf(initialToken),
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
    isAuthenticated: isPending || session !== null,
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

/** The Better Auth session a Convex token was issued for, from its claims. */
function sessionIdOf(token: string | null): string | undefined {
  if (!token) return undefined;
  try {
    const { sessionId } = decodeJwt(token);
    return typeof sessionId === "string" ? sessionId : undefined;
  } catch {
    // Not a JWT, so there's no claim to read.
    return undefined;
  }
}
