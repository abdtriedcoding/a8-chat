import { ConvexError } from "convex/values";
import type { AttachmentNotFound } from "../../convex/attachments";
import type { RateLimited } from "../../convex/rateLimits";

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

/**
 * A message that's safe to show the user. Only a ConvexError carries one
 * (`data.message`, set by the backend); anything else could be an internal
 * detail, so it gets the generic message.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (
      typeof data === "object" &&
      data !== null &&
      "message" in data &&
      typeof data.message === "string"
    ) {
      return data.message;
    }
  }
  return GENERIC_MESSAGE;
}

/**
 * Whether the backend refused because the session is gone, such as after
 * signing out in another tab. The Convex token can outlive the session by up
 * to 15 minutes, so this error can arrive before the client sees the sign-out.
 */
export function isUnauthenticated(error: unknown): boolean {
  if (!(error instanceof ConvexError)) return false;
  const data: unknown = error.data;
  return (
    typeof data === "object" &&
    data !== null &&
    "code" in data &&
    data.code === "UNAUTHENTICATED"
  );
}

/** Why a Send was refused: a rate limit, or an attachment that's gone. */
type SendRefused = RateLimited | AttachmentNotFound;

/**
 * Returns a Send's result, or throws a ConvexError if the Send was refused.
 * The Send mutations return the refusal instead of throwing it (see
 * convex/chat.ts). Throwing it here lets callers handle it like any other
 * error, and errorMessage shows its message.
 */
export function throwIfRefused<T>(result: T | SendRefused): T {
  if (isSendRefused(result)) throw new ConvexError(result);
  return result;
}

function isSendRefused(value: unknown): value is SendRefused {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    (value.code === "RATE_LIMITED" || value.code === "NOT_FOUND")
  );
}
