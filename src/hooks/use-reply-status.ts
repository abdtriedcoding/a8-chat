import { useEffect, useState } from "react";
import { stoppedTurns, type ThreadMessage } from "@/lib/stopped-turns";

// How long to wait for a reply to start before giving up on it.
const REPLY_TIMEOUT_MS = 60_000;

/**
 * Where the reply to the user's latest prompt is:
 * - "waiting": the prompt is saved, but the reply hasn't started.
 * - "timedOut": still no reply after REPLY_TIMEOUT_MS, so it's probably not
 *   coming. Without this, a reply that never starts would block Send for good.
 * - "streaming": the reply is being written.
 * - "idle": no reply in progress, or the user stopped it.
 */
export type ReplyStatus = "waiting" | "timedOut" | "streaming" | "idle";

/** The reply status of a thread, from its messages (oldest first). */
export function useReplyStatus(messages: ThreadMessage[]): ReplyStatus {
  const last = messages.at(-1);
  // The prompt stays last until the reply's first message arrives. The wait
  // goes by the prompt's id, not its key. Regenerate saves the prompt again
  // with the same key and a new id, and the new prompt gets the full wait.
  const waitingPromptId = last?.role === "user" ? last.id : null;
  const timedOut = useTimedOut(waitingPromptId, REPLY_TIMEOUT_MS);

  // A stopped turn is over as soon as the user presses Stop, even if the
  // server is still finishing the reply.
  if (last && stoppedTurns(messages).has(last.order)) return "idle";

  if (waitingPromptId !== null) return timedOut ? "timedOut" : "waiting";
  if (last?.status === "pending" || last?.status === "streaming") {
    return "streaming";
  }
  return "idle";
}

/**
 * True once `key` has stayed the same for `ms`; a new key starts over. The
 * clock starts when this client first sees the key, not at the message's
 * server timestamp, since the two clocks can disagree.
 */
function useTimedOut(key: string | null, ms: number): boolean {
  const [timedOutKey, setTimedOutKey] = useState<string | null>(null);
  // Forgotten once the wait is over, so the same key waiting again gets the
  // full time.
  if (key === null && timedOutKey !== null) setTimedOutKey(null);
  useEffect(() => {
    if (key === null) return;
    // setState in a timer callback, not the effect body (a React Compiler rule).
    const timeout = setTimeout(() => setTimedOutKey(key), ms);
    return () => clearTimeout(timeout);
  }, [key, ms]);
  return key !== null && timedOutKey === key;
}
