import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { APP_HOME } from "@/lib/safe-redirect";

// An optimistic cookie check only: pages still verify the session. Never
// redirect a signed-in user away from sign-in here, because a stale cookie
// would then loop between the two.
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();

  const signIn = new URL("/sign-in", request.url);
  const { pathname, search } = request.nextUrl;
  if (pathname !== APP_HOME || search) signIn.searchParams.set("next", pathname + search);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: [
    // Everything except the landing page at `/` (`.+` needs at least one
    // character after the slash), API routes, Next internals, files with an
    // extension, and the sign-in and sign-up pages.
    "/((?!api/|_next/|sign-in|sign-up|.*\\..*).+)",
  ],
};
