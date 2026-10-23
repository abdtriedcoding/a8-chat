"use client";

import { useQuery } from "convex-helpers/react/cache/hooks";
import { useConvexAuth } from "convex/react";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { isUnauthenticated } from "@/lib/errors";
import { clearLocalCopy } from "@/lib/local-copy";
import { api } from "../../convex/_generated/api";

/**
 * Sends the user to /sign-in when the session ends, such as from another tab,
 * and clears the device's copy of their data.
 *
 * A session revoked from another device, a password change or a deleted
 * account ends the session on the server, but Convex keeps the tab's token
 * until it expires, up to 15 minutes. getCurrentUser reads the session, so it
 * gives null at once. The guard then fetches the Better Auth session again.
 * That gives null too, which signs Convex out, and the response clears the
 * convex_jwt cookie, so proxy.ts no longer sends /sign-in back to /chat.
 *
 * A full page load, not router.replace, so a prefetched /sign-in from while
 * the cookie was still set can't send the user back to /chat.
 */
export function SessionGuard() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const user = useQuery(api.auth.getCurrentUser, isAuthenticated ? {} : "skip");
  const { refetch } = authClient.useSession();
  useEffect(() => {
    if (user === null) void refetch();
  }, [user, refetch]);
  useEffect(() => {
    if (isLoading || isAuthenticated) return;
    void clearLocalCopy().finally(() => window.location.replace("/sign-in"));
  }, [isLoading, isAuthenticated]);
  return null;
}

/**
 * Clears the device's copy of the last user's data on pages only a signed-out
 * visitor sees, for a session that ended while no tab was open.
 */
export function ClearLocalCopy() {
  useEffect(() => {
    void clearLocalCopy();
  }, []);
  return null;
}

/**
 * For error boundaries. Sends the user to /sign-in when `error` says the
 * session is gone, and returns true so the boundary renders nothing
 * meanwhile. A full page load clears the signed-out client's state.
 */
export function useSignInOnUnauthenticated(error: unknown): boolean {
  const signedOut = isUnauthenticated(error);
  useEffect(() => {
    if (!signedOut) return;
    void clearLocalCopy().finally(() => window.location.replace("/sign-in"));
  }, [signedOut]);
  return signedOut;
}
