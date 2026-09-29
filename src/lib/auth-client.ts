import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // Needed during SSR, where there is no window.location to fall back on.
  baseURL: process.env.NEXT_PUBLIC_SITE_URL,
  plugins: [convexClient()],
});
