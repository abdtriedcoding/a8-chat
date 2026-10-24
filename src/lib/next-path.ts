/** Where a user goes after signing in when no page asked for them. */
export const DEFAULT_NEXT = "/chat";

export const AUTH_PAGES = ["/sign-in", "/sign-up", "/forgot-password"];

const ORIGIN = "http://a8.invalid";

// The relative callback URLs Better Auth accepts, from its
// matchesOriginPattern. Google sign-in fails on anything else.
const CALLBACK_PATH = /^\/(?!\/|\\|%2f|%5c)[\w\-.+/@]*(?:\?[\w\-.+/=&%@]*)?$/i;

/**
 * The page to open after sign-in, from a `?next=` value. Only a path on this
 * site is allowed, so a crafted link can't send the user to another site.
 * Anything else, and the auth pages themselves, give /chat. The hash is
 * dropped.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value?.startsWith("/")) return DEFAULT_NEXT;
  let url: URL;
  try {
    url = new URL(value, ORIGIN);
  } catch {
    return DEFAULT_NEXT;
  }
  // Re-encoding the query turns characters the pattern rejects, such as ":"
  // in "?search=09:30", into %XX, which it accepts.
  const query = url.searchParams.toString();
  const path = url.pathname + (query ? `?${query}` : "");
  // "//evil.com" and "/\evil.com" parse as another host.
  if (
    url.origin !== ORIGIN ||
    AUTH_PAGES.includes(url.pathname) ||
    !CALLBACK_PATH.test(path)
  ) {
    return DEFAULT_NEXT;
  }
  return path;
}

/** An auth page's path with `?next=` added, unless next is /chat. */
export function withNext(path: string, next: string): string {
  return next === DEFAULT_NEXT
    ? path
    : `${path}?${new URLSearchParams({ next })}`;
}

/**
 * Where the email verification link lands. A good link signs the user in and
 * the proxy sends them on to `next`. A bad one comes back with `&error=`, and
 * a used one with no session. `verify` tells the sign-in form why it's open.
 */
export function verifyEmailCallback(next: string): string {
  return `${window.location.origin}/sign-in?${new URLSearchParams({ next, verify: "1" })}`;
}
