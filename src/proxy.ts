import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthenticated } from "@/lib/auth-server";

// The auth pages are checked here only, not again in their page.tsx.
const AUTH_PAGES = ["/sign-in", "/sign-up"];

export async function proxy(request: NextRequest) {
  if (AUTH_PAGES.includes(request.nextUrl.pathname)) {
    if (await isAuthenticated()) {
      return NextResponse.redirect(new URL("/chat", request.url));
    }
  } else if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/sign-in", "/sign-up", "/chat", "/c/:path*", "/connectors", "/settings/account"],
};
