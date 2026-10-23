/**
 * A sign-in started away from the Connectors page, like from a thread's
 * Reconnect chip or the composer's blocked-mention banner. The vendor sends
 * the browser back to the Connectors page, which finishes the sign-in and
 * then goes back to `path`. `draft` is the composer's text when the sign-in
 * started, and the composer at `path` puts it back.
 */
type ConnectReturn = {
  connectorId: string;
  path: string;
  draft?: string;
};

// sessionStorage belongs to this tab, which makes the whole round trip to
// the vendor, and it's cleared when the tab closes. Reads and writes can
// throw, for example when storage is blocked, and then a8 just stays on the
// Connectors page.
const KEY = "a8:connect-return";

export function saveConnectReturn(value: ConnectReturn) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {}
}

export function readConnectReturn(): ConnectReturn | undefined {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (
      typeof value === "object" &&
      value !== null &&
      "connectorId" in value &&
      typeof value.connectorId === "string" &&
      "path" in value &&
      typeof value.path === "string"
    ) {
      const draft =
        "draft" in value && typeof value.draft === "string"
          ? value.draft
          : undefined;
      return { connectorId: value.connectorId, path: value.path, draft };
    }
  } catch {}
  return undefined;
}

export function clearConnectReturn() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}

/**
 * The draft a sign-in from the page at `pathname` saved, which is "" when
 * it saved none. Undefined when the saved sign-in is for another page, or
 * there is none. It compares pathnames only, so `/chat?prompt=…` matches
 * `/chat`.
 */
export function savedDraftFor(pathname: string): string | undefined {
  const saved = readConnectReturn();
  return saved && pathnameOf(saved.path) === pathname
    ? (saved.draft ?? "")
    : undefined;
}

/** Forgets the saved sign-in if it's for the page at `pathname`. */
export function forgetConnectReturn(pathname: string) {
  const saved = readConnectReturn();
  if (saved && pathnameOf(saved.path) === pathname) clearConnectReturn();
}

function pathnameOf(path: string): string {
  return path.split("?")[0];
}

/**
 * The current page's path and query, the way ConnectReturn stores it. Read
 * it in event handlers only. Right after a client-side navigation, a render
 * or an effect can still see the previous page's URL.
 */
export function currentPath(): string {
  return window.location.pathname + window.location.search;
}
