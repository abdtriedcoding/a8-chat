import { useQuery } from "convex-helpers/react/cache/hooks";
import { useUIMessages } from "@/hooks/use-ui-messages";
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
