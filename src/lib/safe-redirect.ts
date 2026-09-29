/** Where signed-in users land by default. `/` is the public landing page. */
export const APP_HOME = "/chat";

/**
 * Returns `next` only if it is a same-origin path, so a crafted `?next=` can't
 * send users to another site after sign-in.
 */
export function safeRedirect(next: unknown, fallback = APP_HOME): string {
  if (typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  // The URL parser treats `/\evil.com` and tab/newline tricks the way browsers
  // do, so an origin check catches what the prefix check misses.
  const base = "http://localhost";
  let url: URL;
  try {
    url = new URL(next, base);
  } catch {
    return fallback;
  }
  if (url.origin !== base) return fallback;
  return url.pathname + url.search + url.hash;
}

/** `path`, carrying `next` along as a query param unless it's the app home. */
export function withNext(path: string, next: string): string {
  return next === APP_HOME ? path : `${path}?next=${encodeURIComponent(next)}`;
}
