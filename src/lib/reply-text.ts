import type { ThreadMessage } from "./stopped-turns";

/**
 * A reply's text, with a blank line between the text of each step. The
 * Agent's `message.text` joins steps with a space, which runs a step's
 * closing sentence into the next step's heading or list.
 */
export function replyText(message: ThreadMessage): string {
  return message.parts
    .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
    .join("\n\n");
}

/**
 * The text Copy under the last reply copies: none while the reply is still
 * being written. A stopped reply keeps the text it had.
 */
export function lastReplyText(
  messages: ThreadMessage[],
  stopped: Set<number>,
): string {
  const reply = messages.findLast(({ role }) => role === "assistant");
  if (!reply) return "";
  const writing = reply.status === "pending" || reply.status === "streaming";
  return writing && !stopped.has(reply.order) ? "" : replyText(reply);
}
