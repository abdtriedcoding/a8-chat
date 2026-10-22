import "server-only";
import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";
import { isUnauthenticated } from "@/lib/errors";

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
  fetchAuthQuery,
  fetchAuthAction,
} = convexBetterAuthNextJs({
  convexUrl,
  convexSiteUrl,
  // Reuses the token in the convex_jwt cookie until it expires. With no
  // cookie or an expired one, it fetches a new one. The library's default
  // reuses a token up to 60s past expiry, and 0 fetches as soon as it
  // expires. A call that fails with the cookie's token is retried once with a
  // fresh token, unless the error is UNAUTHENTICATED. Then the session is
  // gone, and a new token can't fix that.
  jwtCache: {
    enabled: true,
    isAuthError: isUnauthenticated,
    expirationToleranceSeconds: 0,
  },
});
