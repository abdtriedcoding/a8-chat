"use client";

import { useConvexAuth } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Sends the user to /sign-in when the session ends, such as from another tab. */
export function SessionGuard() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const router = useRouter();
  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/sign-in");
  }, [isLoading, isAuthenticated, router]);
  return null;
}
