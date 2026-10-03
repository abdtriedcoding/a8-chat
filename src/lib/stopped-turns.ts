import type { UIMessage } from "@convex-dev/agent/react";
import type { MessageMetadata } from "../../convex/chat";

/** A message from listThreadMessages (convex/chat.ts), with its metadata. */
export type ThreadMessage = UIMessage<MessageMetadata>;

/** What a stopped turn carries: whether to keep showing the reply's text. */
export type Stop = MessageMetadata["stopped"];

/**
 * The turns the user stopped, keyed by order. A prompt and its reply have
 * the same order. The prompt always carries the stop, but a reply that's
 * still streaming doesn't, so this checks every message.
 */
export function stoppedTurns(messages: ThreadMessage[]): Map<number, Stop> {
  const turns = new Map<number, Stop>();
  for (const { order, metadata } of messages) {
    if (metadata) turns.set(order, metadata.stopped);
  }
  return turns;
}
