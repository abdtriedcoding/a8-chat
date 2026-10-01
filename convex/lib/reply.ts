import { isStepCount } from "ai";

/** The most model calls one reply makes. Each tool round trip adds one. */
export const MAX_REPLY_STEPS = 5;

const INSTRUCTIONS =
  "You are a8, a helpful AI assistant. Answer clearly and concisely. " +
  "If you don't know something, say so instead of guessing.";

/**
 * Everything a reply's model call gets besides its model and prompt. Built
 * fresh for each reply, so the date is never stale. Tools register here,
 * and only once they're set up (web search is the first).
 */
export function replyOptions({
  timeZone,
  now,
}: {
  /** A time zone the Send has already checked. */
  timeZone: string;
  now: Date;
}) {
  return {
    instructions: `${INSTRUCTIONS}\n\n${dateInstruction(timeZone, now)}`,
    stopWhen: isStepCount(MAX_REPLY_STEPS),
  };
}

/**
 * e.g. "Today is Friday, October 2, 2026, in the user's time zone,
 * Pacific/Kiritimati (GMT+14:00)." Only the date, not the time, so the
 * instructions stay the same all day.
 */
function dateInstruction(timeZone: string, now: Date): string {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "full",
  }).format(now);
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(now)
    .find((part) => part.type === "timeZoneName")?.value;
  return `Today is ${date}, in the user's time zone, ${timeZone}${offset ? ` (${offset})` : ""}.`;
}
