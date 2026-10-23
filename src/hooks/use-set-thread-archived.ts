import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  patchThread,
  updateListPages,
  updatePinned,
  without,
} from "@/lib/optimistic-threads";

/**
 * Archives a thread or moves it back. Drops it from the list it leaves right
 * away, and on archive from the pinned list too. The list it joins gets it
 * from the server, in its place by date.
 */
export function useSetThreadArchived() {
  return useMutation(api.threads.setArchived).withOptimisticUpdate(
    (store, { threadId, archived }) => {
      updateListPages(
        store,
        without(threadId),
        (args) => (args.archived ?? false) !== archived,
      );
      if (archived) updatePinned(store, without(threadId));
      patchThread(store, threadId, { archived });
    },
  );
}
