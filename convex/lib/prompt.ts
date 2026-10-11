import type { Message } from "@convex-dev/agent";
import type { FilePart, ImagePart, ModelMessage } from "ai";
import { appError, ERROR_CODES } from "./errors";

const MAX_PROMPT_LENGTH = 16_000;
const MAX_TITLE_LENGTH = 60;
// Longer than a generated title, so a rename has room.
const MAX_RENAME_LENGTH = 80;

/**
 * A prompt's text, trimmed. Throws if it's too long, or blank when the
 * prompt has no attachments. With attachments, it can be empty.
 */
export function checkPrompt(prompt: string, attachmentCount: number): string {
  const text = prompt.trim();
  if (!text && attachmentCount === 0) {
    throw appError(ERROR_CODES.INVALID_PROMPT, "Type a message first.");
  }
  if (text.length > MAX_PROMPT_LENGTH) {
    throw appError(
      ERROR_CODES.INVALID_PROMPT,
      `Messages can be at most ${MAX_PROMPT_LENGTH.toLocaleString("en-US")} characters.`,
    );
  }
  return text;
}

/**
 * A new prompt's message: its attachments first, then its text. With no
 * attachments, just the text.
 */
export function buildPromptMessage(
  text: string,
  attachmentParts: Array<ImagePart | FilePart>,
): ModelMessage {
  if (attachmentParts.length === 0) return { role: "user", content: text };
  return {
    role: "user",
    content: text
      ? [...attachmentParts, { type: "text", text }]
      : attachmentParts,
  };
}

type UserMessage = Extract<Message, { role: "user" }>;

/**
 * The prompt with its text replaced by `newText`. Image and file parts stay,
 * and the new text goes after them. Throws if the new text is blank and the
 * prompt has no attachments (checkPrompt).
 */
export function replacePromptText(
  prompt: UserMessage,
  newText: string,
): UserMessage {
  if (typeof prompt.content === "string") {
    return { ...prompt, content: checkPrompt(newText, 0) };
  }
  const attachmentParts = prompt.content.filter((part) => part.type !== "text");
  const checkedText = checkPrompt(newText, attachmentParts.length);
  return {
    ...prompt,
    content: checkedText
      ? [...attachmentParts, { type: "text", text: checkedText }]
      : attachmentParts,
  };
}

/**
 * A title the user typed, with whitespace collapsed to single spaces. Throws
 * unless it has 1 to 80 characters.
 */
export function checkTitle(title: string): string {
  const text = title.replace(/\s+/g, " ").trim();
  if (!text) {
    throw appError(ERROR_CODES.INVALID_TITLE, "Type a title first.");
  }
  // Count code points, like titleFromPrompt.
  if (Array.from(text).length > MAX_RENAME_LENGTH) {
    throw appError(
      ERROR_CODES.INVALID_TITLE,
      `Titles can be at most ${MAX_RENAME_LENGTH} characters.`,
    );
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
 * "Title:" label and the marks around the title, cuts it like
 * titleFromPrompt, then drops any trailing punctuation. Empty when nothing
 * is left.
 */
export function cleanTitle(text: string): string {
  const line = text.trim().split("\n")[0];
  const title = line.replace(/^\W*title\s*:/i, "").replace(LEADING_MARKS, "");
  // After the cut, since a cut title ends with "…" and may end on a comma.
  return titleFromPrompt(title).replace(TRAILING_MARKS, "");
}
