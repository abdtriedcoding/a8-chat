import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

/** Turns a thread's auto-approve on or off. The chip changes right away. */
export function useSetAutoApprove() {
  return useMutation(api.autoApprove.setAutoApprove).withOptimisticUpdate(
    (store, { threadId, on }) => {
      const thread = store.getQuery(api.threads.get, { threadId });
      if (thread) {
        store.setQuery(
          api.threads.get,
          { threadId },
          { ...thread, autoApprove: on },
        );
      }
    },
  );
}
