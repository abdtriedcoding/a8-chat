import { ConvexError } from "convex/values";
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
 * Returns a Send's result, or throws a ConvexError if a rate limit refused
 * the Send. The Send mutations return the refusal instead of throwing it
 * (limitSend). Throwing it here lets callers handle it like any other
 * error, and errorMessage shows its message.
 */
export function throwIfRateLimited<T>(result: T | RateLimited): T {
  if (isRateLimited(result)) throw new ConvexError(result);
  return result;
}

function isRateLimited(value: unknown): value is RateLimited {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    value.code === "RATE_LIMITED"
  );
}
