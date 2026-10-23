import { useEffect, useSyncExternalStore } from "react";
import type { ThreadMessage } from "@/lib/stopped-turns";

/**
 * A thread the new-chat page just started, as it hands it to the thread
 * page: the first prompt, and what the page's Composer showed. The thread
 * page shows the prompt in place of a skeleton until its first page of
 * messages loads.
 */
type StartingThread = {
  prompt: ThreadMessage;
  temporary: boolean;
  autoApprove: boolean;
  modelId: string | undefined;
};

const startingThreads = new Map<string, StartingThread>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setStartingThread(threadId: string, thread: StartingThread) {
  startingThreads.set(threadId, thread);
  notify();
}

/** Called once the thread's first page of messages has loaded. */
export function clearStartingThread(threadId: string) {
  if (startingThreads.delete(threadId)) notify();
}

/** The thread the new-chat page handed over with this id, if any. */
export function useStartingThread(
  threadId: string,
): StartingThread | undefined {
  return useSyncExternalStore(
    subscribe,
    () => startingThreads.get(threadId),
    () => undefined,
  );
}

/**
 * Clears the starting thread when the page unmounts on a route other than
 * the thread's own, such as a click elsewhere before the thread page loads.
 * Otherwise a later visit would show the old prompt and "Thinking…" again.
 * The router has already changed the URL when the page unmounts. Strict
 * Mode's extra unmount keeps the URL, so it clears nothing.
 */
export function useClearStartingThreadOnLeave(threadId: string | undefined) {
  useEffect(() => {
    if (threadId === undefined) return;
    return () => {
      if (window.location.pathname !== `/c/${threadId}`) {
        clearStartingThread(threadId);
      }
    };
  }, [threadId]);
}
