import { ConvexError } from "convex/values";
import { ERROR_CODES, type ErrorCode } from "../../convex/lib/errors";
import type { AttachmentNotFound } from "../../convex/attachments/load";
import type { QueueFull } from "../../convex/chat/send";
import type { ModelLocked } from "../../convex/lib/threadModels";
import type { SendLimited } from "../../convex/rateLimits";

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
  return hasErrorCode(error, ERROR_CODES.UNAUTHENTICATED);
}

/**
 * Whether the backend refused a Send because the user has no credits left.
 * The toast then links to the Billing page (useErrorToast).
 */
export function isOutOfCredits(error: unknown): boolean {
  return hasErrorCode(error, ERROR_CODES.OUT_OF_CREDITS);
}

/**
 * Whether a connection failed in a way that may work if tried again, such as
 * dictation's token when Deepgram couldn't be reached.
 */
export function isConnectFailed(error: unknown): boolean {
  return hasErrorCode(error, ERROR_CODES.CONNECT_FAILED);
}

function hasErrorCode(error: unknown, code: ErrorCode): boolean {
  if (!(error instanceof ConvexError)) return false;
  const data: unknown = error.data;
  return (
    typeof data === "object" &&
    data !== null &&
    "code" in data &&
    data.code === code
  );
}

/**
 * Why a Send was refused: a rate limit, no credits left, the daily spend
 * ceiling, an attachment that's gone, a full queue, or a model the user's
 * plan doesn't include.
 */
type SendRefused = SendLimited | AttachmentNotFound | QueueFull | ModelLocked;

/**
 * Returns a Send's result, or throws a ConvexError if the Send was refused.
 * The Send mutations return the refusal instead of throwing it (see
 * convex/chat/send.ts). Throwing it here lets callers handle it like any other
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
    (value.code === ERROR_CODES.RATE_LIMITED ||
      value.code === ERROR_CODES.OUT_OF_CREDITS ||
      value.code === ERROR_CODES.DAILY_SPEND_CEILING ||
      value.code === ERROR_CODES.NOT_FOUND ||
      value.code === ERROR_CODES.QUEUE_FULL ||
      value.code === ERROR_CODES.MODEL_LOCKED)
  );
}
