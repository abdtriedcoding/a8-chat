import { ConvexError } from "convex/values";

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
