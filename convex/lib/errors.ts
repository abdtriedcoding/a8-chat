/**
 * The one list of error codes the backend sends and the UI checks.
 *
 * Return or throw: functions the composer calls for a Send or an upload
 * return a refusal as `{ code, message }`, so the Convex client doesn't log
 * it as an error. Everything else throws `appError(...)`.
 */
import { ConvexError } from "convex/values";

export const ERROR_CODES = {
  ACTION_NOT_WAITING: "ACTION_NOT_WAITING",
  ALREADY_ON_PLAN: "ALREADY_ON_PLAN",
  CONNECT_FAILED: "CONNECT_FAILED",
  DAILY_SPEND_CEILING: "DAILY_SPEND_CEILING",
  INVALID_ATTACHMENT: "INVALID_ATTACHMENT",
  INVALID_PROMPT: "INVALID_PROMPT",
  INVALID_SCHEDULE: "INVALID_SCHEDULE",
  INVALID_TITLE: "INVALID_TITLE",
  MISCONFIGURED: "MISCONFIGURED",
  NEEDS_RECONNECT: "NEEDS_RECONNECT",
  NO_PROMPT: "NO_PROMPT",
  NOT_FOUND: "NOT_FOUND",
  NOTHING_TO_SHARE: "NOTHING_TO_SHARE",
  OUT_OF_CREDITS: "OUT_OF_CREDITS",
  QUEUE_FULL: "QUEUE_FULL",
  RATE_LIMITED: "RATE_LIMITED",
  REPLY_IN_PROGRESS: "REPLY_IN_PROGRESS",
  SCHEDULED_THREAD: "SCHEDULED_THREAD",
  TEMPORARY_THREAD: "TEMPORARY_THREAD",
  THREAD_ARCHIVED: "THREAD_ARCHIVED",
  TOO_MANY_ATTACHMENTS: "TOO_MANY_ATTACHMENTS",
  TOO_MANY_SCHEDULED_PROMPTS: "TOO_MANY_SCHEDULED_PROMPTS",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  UNKNOWN_MODEL: "UNKNOWN_MODEL",
  UNSUPPORTED_ATTACHMENT: "UNSUPPORTED_ATTACHMENT",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export type AppErrorData<C extends ErrorCode = ErrorCode> = {
  code: C;
  message: string;
};

/** A ConvexError whose data is `{ code, message }`. */
export function appError<C extends ErrorCode>(code: C, message: string) {
  return new ConvexError<AppErrorData<C>>({ code, message });
}
