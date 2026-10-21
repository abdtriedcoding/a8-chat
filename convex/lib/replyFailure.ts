/** The reason a failed reply shows when its attachments didn't fit. */
const ATTACHMENTS_TOO_LARGE =
  "The attachments are too large for this model.";

/**
 * The labs' errors for a request too big for the model, as AI Gateway
 * passes them on. Anthropic's: too many PDF pages or images, a file over
 * its limit, too many bytes, or more tokens than the context window holds.
 * OpenAI's and Google's: more tokens than the context window holds. A
 * prompt's text is capped at 16,000 characters (checkPrompt), so
 * attachments are what makes a request this big. Other errors show the
 * generic failure.
 */
const TOO_LARGE_ERRORS = [
  // OpenAI: "Your input exceeds the context window of this model. ..."
  /exceeds the context window/i,
  // Google: "The input token count exceeds the maximum number of tokens
  // allowed (1048576)."
  /input token count exceeds the maximum number of tokens/i,
  // "prompt is too long: 215000 tokens > 200000 maximum"
  /prompt is too long/i,
  // "input length and `max_tokens` exceed context limit: ..."
  /exceed context limit/i,
  // "A maximum of 100 PDF pages may be provided."
  /maximum of \d+ PDF pages/i,
  /too many (total )?(images|pages|documents)/i,
  // "image exceeds 5 MB maximum: ..."
  /exceeds \d+ ?MB maximum/i,
  // HTTP 413
  /request exceeds the maximum allowed number of bytes/i,
];

/**
 * A short reason to show for a failed reply, or undefined if its error isn't
 * one we know. `error` is the error saved on the reply. That's the model
 * provider's error message, or a generic one if the reply failed before the
 * model call (failReplyStart).
 */
export function replyFailureReason(
  error: string | undefined,
): string | undefined {
  if (error && TOO_LARGE_ERRORS.some((pattern) => pattern.test(error))) {
    return ATTACHMENTS_TOO_LARGE;
  }
  return undefined;
}
