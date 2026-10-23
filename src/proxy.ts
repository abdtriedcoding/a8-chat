import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthenticated } from "@/lib/auth-server";

const AUTH_PAGES = ["/sign-in", "/sign-up", "/forgot-password"];

/**
 * How long an auth page waits for Convex to confirm the session. A token
 * fetch takes about 0.8s.
 */
const AUTH_CHECK_TIMEOUT_MS = 3000;

/**
 * Whether the visitor is signed in, for sending them from an auth page to
 * /chat. Gives false if Convex can't be reached or takes too long, so the
 * page renders and the user can sign in again instead of getting a 500.
 */
async function isSignedIn(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      isAuthenticated(),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), AUTH_CHECK_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function proxy(request: NextRequest) {
  const hasSessionCookie = getSessionCookie(request) !== null;
  if (AUTH_PAGES.includes(request.nextUrl.pathname)) {
    // An anonymous visitor gets the static page with no Convex call.
    if (hasSessionCookie && (await isSignedIn())) {
      return NextResponse.redirect(new URL("/chat", request.url));
    }
  } else if (!hasSessionCookie) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/sign-in",
    "/sign-up",
    "/forgot-password",
    "/chat",
    "/c/:path*",
    "/connectors",
    "/archived",
    "/scheduled",
    "/settings/account",
    "/settings/billing",
  ],
};
