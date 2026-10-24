import { usePaginatedQueryWithLocalCopy } from "@/hooks/use-query-with-local-copy";
import { api } from "../../convex/_generated/api";

/** How many chats the list loads at a time. */
export const THREAD_LIST_PAGE_SIZE = 30;

/**
 * The user's chats, newest first, without the pinned ones: the sidebar's
 * list. Until the first page loads, the device's copy of it shows, stale.
 * The sidebar and the search dialog share one subscription through it.
 */
export function useThreadList() {
  return usePaginatedQueryWithLocalCopy(
    api.threads.list,
    {},
    { initialNumItems: THREAD_LIST_PAGE_SIZE },
  );
}
