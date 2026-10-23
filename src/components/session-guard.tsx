"use client";

import { useConvexAuth } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isUnauthenticated } from "@/lib/errors";
import { clearLocalCopy } from "@/lib/local-copy";

/**
 * Sends the user to /sign-in when the session ends, such as from another tab,
 * and clears the device's copy of their data.
 */
export function SessionGuard() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const router = useRouter();
  useEffect(() => {
    if (isLoading || isAuthenticated) return;
    void clearLocalCopy();
    router.replace("/sign-in");
  }, [isLoading, isAuthenticated, router]);
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
