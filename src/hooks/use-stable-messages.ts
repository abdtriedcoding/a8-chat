import { useState } from "react";
import type { ThreadMessage } from "@/lib/stopped-turns";

/**
 * The thread's messages, where each message that hasn't changed is the same
 * object as on the last render. useUIMessages returns a new array on every
 * render. It builds a reply made of several steps again on every stream
 * chunk, and it returns new objects for every message when a step is saved.
 * Without this, every memoized row in MessageList would render again.
 */
export function useStableMessages(messages: ThreadMessage[]): ThreadMessage[] {
  const [stable, setStable] = useState(messages);
  const next = keepUnchanged(stable, messages);
  if (next !== stable) setStable(next);
  return next;
}

/**
 * `next`, with each message equal to one in `previous` swapped for that one.
 * Returns `previous` itself when nothing changed.
 */
function keepUnchanged(
  previous: ThreadMessage[],
  next: ThreadMessage[],
): ThreadMessage[] {
  const previousById = new Map(previous.map((message) => [message.id, message]));
  let changed = previous.length !== next.length;
  const result = next.map((message, i) => {
    // Most messages keep their place, so look there first.
    const before =
      previous[i]?.id === message.id
        ? previous[i]
        : previousById.get(message.id);
    const kept = before && sameMessage(before, message) ? before : message;
    if (kept !== previous[i]) changed = true;
    return kept;
  });
  return changed ? result : previous;
}

// This serializes only messages that are new objects: the streaming reply,
// replies made of several steps, and every message after a step is saved.
function sameMessage(a: ThreadMessage, b: ThreadMessage) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
