import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * The threads.rename mutation. The new title shows in the sidebar and the
 * header right away, and goes back if the server refuses it.
 */
export function useRenameThread() {
  return useMutation(api.threads.rename).withOptimisticUpdate(
    (store, { threadId, title }) => {
      for (const { args, value } of store.getAllQueries(api.threads.list)) {
        if (!value) continue;
        store.setQuery(api.threads.list, args, {
          ...value,
          page: value.page.map((t) =>
            t._id === threadId ? { ...t, title } : t,
          ),
        });
      }
      const thread = store.getQuery(api.threads.get, { threadId });
      if (thread) {
        store.setQuery(api.threads.get, { threadId }, { ...thread, title });
      }
    },
  );
}
