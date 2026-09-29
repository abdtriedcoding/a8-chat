"use client";

import {
  ConvexBetterAuthProvider,
  type AuthClient,
} from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { authClient } from "@/lib/auth-client";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error(
    "Missing NEXT_PUBLIC_CONVEX_URL. Run `bunx convex dev` to create .env.local.",
  );
}

const convex = new ConvexReactClient(convexUrl);

// Type-only cast. From better-auth 1.6.18 on, the provider's AuthClient type
// infers `useSession().data` as `never`, so no real client matches it (and
// only a cast through unknown compiles). The runtime API it calls (useSession,
// convex.token, getSession) is unchanged. Remove once @convex-dev/better-auth
// ships types for newer 1.6.x releases.
const providerAuthClient = authClient as unknown as AuthClient;

export function ConvexClientProvider({
  children,
  initialToken,
}: {
  children: ReactNode;
  initialToken?: string | null;
}) {
  return (
    <ConvexBetterAuthProvider
      client={convex}
      authClient={providerAuthClient}
      initialToken={initialToken}
    >
      {children}
    </ConvexBetterAuthProvider>
  );
}
