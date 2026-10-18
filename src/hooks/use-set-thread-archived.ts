import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * Archives a thread or moves it back. Drops it from the list it leaves right
 * away. The list it joins gets it from the server, in its place by date.
 */
export function useSetThreadArchived() {
  return useMutation(api.threads.setArchived).withOptimisticUpdate(
    (store, { threadId, archived }) => {
      for (const { args, value } of store.getAllQueries(api.threads.list)) {
        if (!value || (args.archived ?? false) === archived) continue;
        store.setQuery(api.threads.list, args, {
          ...value,
          page: value.page.filter((t) => t._id !== threadId),
        });
      }
      const thread = store.getQuery(api.threads.get, { threadId });
      if (thread) {
        store.setQuery(api.threads.get, { threadId }, { ...thread, archived });
      }
    },
  );
}
