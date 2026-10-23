import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  updateListPages,
  updatePinned,
  without,
} from "@/lib/optimistic-threads";

/**
 * Pins a thread or unpins it. Pinning moves it from the chats list to the
 * top of the pinned list right away. Unpinning drops it from the pinned
 * list, and the chats list gets it from the server, in its place by date.
 */
export function useSetThreadPinned() {
  return useMutation(api.threads.setPinned).withOptimisticUpdate(
    (store, { threadId, pinned }) => {
      if (!pinned) return updatePinned(store, without(threadId));
      const pins = store.getQuery(api.threads.listPinned, {});
      let thread = pins?.find((t) => t._id === threadId);
      updateListPages(
        store,
        (page) => {
          thread ??= page.find((t) => t._id === threadId);
          return without(threadId)(page);
        },
        (args) => !args.archived,
      );
      if (pins && thread && !pins.some((t) => t._id === threadId)) {
        store.setQuery(api.threads.listPinned, {}, [thread, ...pins]);
      }
    },
  );
}
