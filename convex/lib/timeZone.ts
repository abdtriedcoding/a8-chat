import { v } from "convex/values";

const FALLBACK_TIME_ZONE = "UTC";

// The browser's time zone, unchecked. Each Send and decideAction checks it
// (resolveTimeZone).
export const vTimeZone = v.optional(v.string());

export function resolveTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return FALLBACK_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}
