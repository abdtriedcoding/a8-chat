import { useQuery } from "convex-helpers/react/cache/hooks";
import { useConvexAuth } from "convex/react";
import { useEffect } from "react";
import { useUIMessages } from "@/hooks/use-ui-messages";
import {
  removeLocalCopy,
  saveLocalCopy,
  threadCopyKey,
  useLocalCopy,
} from "@/lib/local-copy";
import { api } from "../../convex/_generated/api";

/** Messages a thread loads at first, and on each "Load earlier messages". */
export const MESSAGES_PAGE_SIZE = 20;

/**
 * A thread, its messages and its queue. The thread view and the sidebar's
 * prefetch both read them through this hook. The query cache shares a
 * subscription only between calls with the same query name and args, so a
 * prefetch built from other args would open subscriptions the thread view
 * never reads.
 *
 * `stream: false` leaves out the reply that's streaming, for the prefetch.
 * It doesn't change the other queries' args.
 */
export function useThreadQueries(
  threadId: string,
  { stream }: { stream: boolean },
) {
  const thread = useQuery(api.threads.get, { threadId });
  // A thread that's missing or someone else's loads nothing more. The rest
  // start while the thread is still loading, alongside it.
  const threadArgs = thread !== null ? { threadId } : "skip";
  const messages = useUIMessages(
    api.chat.messages.listThreadMessages,
    threadArgs,
    { initialNumItems: MESSAGES_PAGE_SIZE, stream },
  );
  const queue = useQuery(api.chat.queue.getQueue, threadArgs);
  return { thread, messages, queue };
}

type ThreadQueries = ReturnType<typeof useThreadQueries>;

/** What the device keeps of a thread the user opened (lib/local-copy). */
export type ThreadCopy = {
  thread: NonNullable<ThreadQueries["thread"]>;
  /** The last page of messages, as the thread view showed them. */
  messages: ThreadQueries["messages"]["results"];
  /** Whether the thread has messages before these. */
  hasEarlier: boolean;
};

/**
 * The thread view's queries, plus `copy`: the device's copy of the thread,
 * set while the thread or its first page is still loading. The copy is
 * saved as they update and dropped once the thread is gone. Temporary
 * threads are never saved.
 */
export function useThreadWithLocalCopy(threadId: string) {
  const queries = useThreadQueries(threadId, { stream: true });
  // Copies only what Convex answered for the confirmed user.
  const { isAuthenticated } = useConvexAuth();
  const {
    thread,
    messages: { results, status },
  } = queries;
  const key = threadCopyKey(threadId);
  const copy = useLocalCopy<ThreadCopy>(key);
  const loaded = thread != null && status !== "LoadingFirstPage";
  useEffect(() => {
    if (!isAuthenticated) return;
    if (thread === null) {
      removeLocalCopy(key);
    } else if (loaded && !thread.temporary) {
      saveLocalCopy(key, {
        thread,
        messages: results.slice(-MESSAGES_PAGE_SIZE),
        hasEarlier:
          status !== "Exhausted" || results.length > MESSAGES_PAGE_SIZE,
      } satisfies ThreadCopy);
    }
  }, [isAuthenticated, key, thread, loaded, results, status]);
  return {
    ...queries,
    copy: loaded || thread === null ? undefined : copy,
  };
}
