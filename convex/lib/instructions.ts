const INSTRUCTIONS =
  "You are a8, a helpful AI assistant. Answer clearly and concisely. " +
  "If you don't know something, say so instead of guessing.";

// Matches what the chat renders (src/components/chat/markdown.tsx).
const FORMATTING =
  "Replies render as GitHub-flavored Markdown, so use headings, lists, " +
  "tables, links and fenced code blocks with a language tag where they help. " +
  "For math, write LaTeX between double dollar signs. Inline, within a " +
  "sentence: $$E = mc^2$$. For a block equation, put each $$ alone on its " +
  "own line:\n$$\nE = mc^2\n$$\n" +
  "Single dollar signs, \\( \\) and \\[ \\] don't render as math, so a " +
  "single $ is safe for prices.";

/**
 * A reply's instructions, which override the Agent's. Built fresh for each
 * reply, so the date is never stale.
 *
 * @param timeZone A time zone already checked by resolveTimeZone.
 */
export function replyInstructions(timeZone: string, now: Date): string {
  return [INSTRUCTIONS, FORMATTING, dateInstruction(timeZone, now)].join(
    "\n\n",
  );
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
