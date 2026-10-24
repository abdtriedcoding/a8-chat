import {
  CONNECT_ERRORS,
  type ConnectError,
} from "../../convex/lib/connectorView";

/**
 * What the callback's redirect (convex/connectors.ts) put in the
 * Connectors page's URL fragment: a sign-in to finish, or why it ended.
 */
export type ConnectCallback =
  | { finish: { state: string; code: string; iss?: string } }
  | { error: ConnectError };

// When the callback reaches a signed-out browser, the proxy sends it from
// the Connectors page to sign-in, and the fragment goes along. The sign-in
// page moves a sign-in to finish here until the user is back on the
// Connectors page. sessionStorage belongs to this tab, so it survives
// signing in with Google, and it never reaches a server. Reads and writes
// can throw, for example when storage is blocked, and then the user starts
// the sign-in again.
const KEY = "a8:connect-callback";

/** As long as the server keeps the sign-in (PENDING_CONNECT_TTL_MS). */
const HOLD_MS = 10 * 60 * 1000;

function parseCallback(fragment: string): ConnectCallback | null {
  const params = new URLSearchParams(fragment);
  const error = CONNECT_ERRORS.find((code) => code === params.get("error"));
  if (error) return { error };
  const state = params.get("finish");
  const code = params.get("code");
  if (state === null || code === null) return null;
  return { finish: { state, code, iss: params.get("iss") ?? undefined } };
}

function callbackInHash(): ConnectCallback | null {
  return parseCallback(window.location.hash.slice(1));
}

function readHeld(): ConnectCallback | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (
      typeof value === "object" &&
      value !== null &&
      "fragment" in value &&
      typeof value.fragment === "string" &&
      "heldAt" in value &&
      typeof value.heldAt === "number" &&
      Date.now() - value.heldAt < HOLD_MS
    ) {
      return parseCallback(value.fragment);
    }
  } catch {}
  return null;
}

function clearHeld() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}

/** Removes the fragment, so a code leaves the URL and history. */
function clearHash() {
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
}

/**
 * The callback for the Connectors page to handle, from the URL fragment or
 * held through sign-in. Taking it removes it, so it's handled once.
 */
export function takeConnectCallback(): ConnectCallback | null {
  const callback = callbackInHash() ?? readHeld();
  if (callback) clearHash();
  clearHeld();
  return callback;
}

/**
 * On the sign-in page, moves a sign-in to finish from the URL fragment to
 * sessionStorage, for the Connectors page to take once the user signs in.
 * Drops a callback that only says why a sign-in ended, since there's
 * nothing left to finish.
 */
export function holdConnectCallback() {
  const callback = callbackInHash();
  if (!callback) return;
  if ("finish" in callback) {
    try {
      sessionStorage.setItem(
        KEY,
        JSON.stringify({
          fragment: window.location.hash.slice(1),
          heldAt: Date.now(),
        }),
      );
    } catch {}
  }
  clearHash();
}

/**
 * Whether signing in should go on to the Connectors page to finish a
 * connector sign-in. Reads the URL fragment too, since the sign-in page
 * renders before holdConnectCallback runs.
 */
export function hasConnectCallback(): boolean {
  const callback = callbackInHash() ?? readHeld();
  return callback !== null && "finish" in callback;
}
