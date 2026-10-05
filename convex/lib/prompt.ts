import { ConvexError } from "convex/values";

const MAX_PROMPT_LENGTH = 16_000;
const MAX_TITLE_LENGTH = 60;

export function checkPrompt(prompt: string): string {
  const text = prompt.trim();
  if (!text) {
    throw new ConvexError({
      code: "INVALID_PROMPT",
      message: "Type a message first.",
    });
  }
  if (text.length > MAX_PROMPT_LENGTH) {
    throw new ConvexError({
      code: "INVALID_PROMPT",
      message: `Messages can be at most ${MAX_PROMPT_LENGTH.toLocaleString("en-US")} characters.`,
    });
  }
  return text;
}

/**
 * A thread title from its first prompt: whitespace collapsed to single
 * spaces, then cut to about 60 characters at a word boundary.
 */
export function titleFromPrompt(prompt: string): string {
  const text = prompt.replace(/\s+/g, " ").trim();
  // Count code points, not UTF-16 units, so the cut never splits an emoji
  // into a lone surrogate (Convex rejects strings that aren't valid Unicode).
  const chars = Array.from(text);
  if (chars.length <= MAX_TITLE_LENGTH) return text;

  const head = chars.slice(0, MAX_TITLE_LENGTH + 1).join("");
  const lastSpace = head.lastIndexOf(" ");
  // Only cut at a word boundary when it keeps most of the text; one long
  // word (a URL, say) is cut mid-word instead.
  const cut =
    lastSpace >= MAX_TITLE_LENGTH / 2
      ? head.slice(0, lastSpace)
      : chars.slice(0, MAX_TITLE_LENGTH).join("");
  return `${cut.trimEnd()}…`;
}

// Marks a model may put around a title, such as quotes or bold.
const LEADING_MARKS = /^[\s"'`*_#“”‘’«»「」]+/u;
// The same marks, plus punctuation the title shouldn't end with.
const TRAILING_MARKS = /[\s"'`*_“”‘’«»「」.,;:!?…。！？]+$/u;

/**
 * A title the model wrote, cleaned up. It keeps the first line, drops a
 * "Title:" label, the marks around the title and any trailing punctuation,
 * then cuts it like titleFromPrompt. Empty when nothing is left.
 */
export function cleanTitle(text: string): string {
  const line = text.trim().split("\n")[0];
  const title = line
    .replace(/^\W*title\s*:/i, "")
    .replace(LEADING_MARKS, "")
    .replace(TRAILING_MARKS, "");
  return titleFromPrompt(title);
}
