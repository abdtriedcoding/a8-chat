// How an app's sign-in reports back. The sign-in ends on /apps/callback,
// either in the popup or, when popups are blocked, in the tab itself. The
// popup tells the opening tab over a BroadcastChannel. A full-page sign-in
// leaves the outcome in sessionStorage for the page it returns to.
import type { SignInResult } from "../../convex/connections";
import { isLocalPath } from "../../convex/lib/localPath";

export type SignInOutcome = {
  result: SignInResult;
  connector?: string;
  /** The app's name, kept through a full-page sign-in. */
  name?: string;
};

export const SIGN_IN_CHANNEL = "a8-app-sign-in";
/** The app's name, set while this tab is away on a full-page sign-in. */
export const REDIRECT_KEY = "a8-app-sign-in-redirect";
/** The outcome of a full-page sign-in, waiting for the page to read it. */
export const OUTCOME_KEY = "a8-app-sign-in-outcome";

const RESULTS: readonly SignInResult[] = [
  "connected",
  "cancelled",
  "failed",
  "expired",
];

export function isSignInOutcome(value: unknown): value is SignInOutcome {
  return (
    typeof value === "object" &&
    value !== null &&
    "result" in value &&
    RESULTS.some((result) => result === value.result)
  );
}

/** `path` if it's a page on this site, else /apps. */
export function safeReturnPath(path: string | null): string {
  return path && isLocalPath(path) ? path : "/apps";
}
