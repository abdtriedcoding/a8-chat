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
