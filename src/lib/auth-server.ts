import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";
import { redirect } from "next/navigation";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;

if (!convexUrl || !convexSiteUrl) {
  throw new Error(
    "Missing NEXT_PUBLIC_CONVEX_URL or NEXT_PUBLIC_CONVEX_SITE_URL. Run `bunx convex dev` to create .env.local.",
  );
}

export const {
  handler,
  isAuthenticated,
  getToken,
  preloadAuthQuery,
  fetchAuthQuery,
  fetchAuthMutation,
  fetchAuthAction,
} = convexBetterAuthNextJs({ convexUrl, convexSiteUrl });

// Page-level checks. proxy.ts redirects first, but every page checks again
// so a matcher gap or a skipped proxy can't expose it. Both reuse the
// request's cached token, so the repeat check costs nothing.

/** Sends signed-out visitors to /sign-in. */
export async function requireSignedIn() {
  if (!(await isAuthenticated())) redirect("/sign-in");
}

/** Sends signed-in users to /chat, for pages only signed-out visitors need. */
export async function requireSignedOut() {
  if (await isAuthenticated()) redirect("/chat");
}
