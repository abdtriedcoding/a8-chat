/** The reason a failed reply shows when its attachments didn't fit. */
const ATTACHMENTS_TOO_LARGE =
  "The attachments are too large for this model.";

/**
 * Anthropic's errors for a request too big for the model: too many PDF
 * pages or images, a file over its limit, too many bytes, or more tokens
 * than the context window holds. A prompt's text is capped at 16,000
 * characters (checkPrompt), so attachments are what makes a request this
 * big.
 */
const TOO_LARGE_ERRORS = [
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
 * one we know. `error` is the error the Agent saved on the reply, which is
 * the model provider's error message.
 */
export function replyFailureReason(
  error: string | undefined,
): string | undefined {
  if (error && TOO_LARGE_ERRORS.some((pattern) => pattern.test(error))) {
    return ATTACHMENTS_TOO_LARGE;
  }
  return undefined;
}
