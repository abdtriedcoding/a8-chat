"use client";

import { useConvexAuth } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isUnauthenticated } from "@/lib/errors";

/** Sends the user to /sign-in when the session ends, such as from another tab. */
export function SessionGuard() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const router = useRouter();
  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/sign-in");
  }, [isLoading, isAuthenticated, router]);
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
    if (signedOut) window.location.replace("/sign-in");
  }, [signedOut]);
  return signedOut;
}
