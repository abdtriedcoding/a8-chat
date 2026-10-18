import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * Drops the thread from the loaded pages right away. The server deletes long
 * threads in batches, and the row goes last.
 */
export function useRemoveThread() {
  return useMutation(api.threads.remove).withOptimisticUpdate(
    (store, { threadId }) => {
      for (const { args, value } of store.getAllQueries(api.threads.list)) {
        if (!value) continue;
        store.setQuery(api.threads.list, args, {
          ...value,
          page: value.page.filter((t) => t._id !== threadId),
        });
      }
    },
  );
}
