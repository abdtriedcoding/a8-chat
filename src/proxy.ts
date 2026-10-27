import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthenticated } from "@/lib/auth-server";
import { AUTH_PAGES, safeNext, withNext } from "@/lib/next-path";

/**
 * How long an auth page waits for Convex to confirm the session. A token
 * fetch takes about 0.8s.
 */
const AUTH_CHECK_TIMEOUT_MS = 3000;

/**
 * Whether the visitor is signed in, for sending them from an auth page to
 * `?next=` or /chat. Gives false if Convex can't be reached or takes too
 * long, so the page renders and the user can sign in again instead of
 * getting a 500.
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

/**
 * A thread page whose ID can't be a thread's: anything but 31 to 37
 * lowercase letters and digits, the shape of a Convex document ID.
 */
const MALFORMED_THREAD_PATH = /^\/c\/(?![0-9a-z]{31,37}$)[^/]*$/;

export async function proxy(request: NextRequest) {
  // The chat layout streams before the page runs, so a notFound() there
  // would answer 200. This path matches no route, so it renders the root
  // not-found page with a 404.
  if (MALFORMED_THREAD_PATH.test(request.nextUrl.pathname)) {
    return NextResponse.rewrite(new URL("/c/not-found/x", request.url));
  }
  const hasSessionCookie = getSessionCookie(request) !== null;
  if (AUTH_PAGES.includes(request.nextUrl.pathname)) {
    // An anonymous visitor gets the static page with no Convex call.
    if (hasSessionCookie && (await isSignedIn())) {
      const next = safeNext(request.nextUrl.searchParams.get("next"));
      return NextResponse.redirect(new URL(next, request.url));
    }
  } else if (!hasSessionCookie) {
    const { pathname, search } = request.nextUrl;
    const signIn = withNext("/sign-in", safeNext(pathname + search));
    return NextResponse.redirect(new URL(signIn, request.url));
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
