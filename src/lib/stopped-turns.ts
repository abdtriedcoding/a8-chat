import type { UIMessage } from "@convex-dev/agent/react";
import type { MessageMetadata } from "../../convex/chat/messages";

/**
 * A message from listThreadMessages (convex/chat/messages.ts), with its
 * metadata.
 */
export type ThreadMessage = UIMessage<MessageMetadata>;

/**
 * The orders of the turns the user stopped. A prompt and its reply have the
 * same order. The prompt always carries the stop, but a reply that's
 * still streaming doesn't, so this checks every message.
 */
export function stoppedTurns(messages: ThreadMessage[]): Set<number> {
  const turns = new Set<number>();
  for (const { order, metadata } of messages) {
    if (metadata?.stopped) turns.add(order);
  }
  return turns;
}
