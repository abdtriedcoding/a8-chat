"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache/provider";
import type { ReactNode } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error(
    "Missing NEXT_PUBLIC_CONVEX_URL. Run `bunx convex dev` to create .env.local.",
  );
}

const convex = new ConvexReactClient(convexUrl);

/**
 * Convex without a session, for public pages. A signed-in visitor reads them
 * as anyone else would.
 */
export function PublicConvexProvider({ children }: { children: ReactNode }) {
  // The cache provider lets components shared with the chat pages use the
  // cached query hooks here too.
  return (
    <ConvexProvider client={convex}>
      <ConvexQueryCacheProvider>{children}</ConvexQueryCacheProvider>
    </ConvexProvider>
  );
}
