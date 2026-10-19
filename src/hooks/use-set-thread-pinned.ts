import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * Pins a thread or unpins it. Pinning moves it from the chats list to the
 * top of the pinned list right away. Unpinning drops it from the pinned
 * list, and the chats list gets it from the server, in its place by date.
 */
export function useSetThreadPinned() {
  return useMutation(api.threads.setPinned).withOptimisticUpdate(
    (store, { threadId, pinned }) => {
      const pins = store.getQuery(api.threads.listPinned, {});
      if (!pinned) {
        if (pins) {
          store.setQuery(
            api.threads.listPinned,
            {},
            pins.filter((t) => t._id !== threadId),
          );
        }
        return;
      }
      let thread = pins?.find((t) => t._id === threadId);
      for (const { args, value } of store.getAllQueries(api.threads.list)) {
        if (!value || args.archived) continue;
        thread ??= value.page.find((t) => t._id === threadId);
        store.setQuery(api.threads.list, args, {
          ...value,
          page: value.page.filter((t) => t._id !== threadId),
        });
      }
      if (pins && thread && !pins.some((t) => t._id === threadId)) {
        store.setQuery(api.threads.listPinned, {}, [thread, ...pins]);
      }
    },
  );
}
