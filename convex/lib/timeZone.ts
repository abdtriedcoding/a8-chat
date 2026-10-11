import { v } from "convex/values";

const FALLBACK_TIME_ZONE = "UTC";

// The browser's IANA time zone, such as "Europe/Berlin". Each Send and
// decideAction passes it so replies know the user's date.
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// The browser's time zone, unchecked until resolveTimeZone runs on it.
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
