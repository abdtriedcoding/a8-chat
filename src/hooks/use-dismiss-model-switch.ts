import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

/** Hides the note about a thread's last model switch, right away. */
export function useDismissModelSwitch() {
  return useMutation(api.models.dismissModelSwitch).withOptimisticUpdate(
    (store, { threadId }) => {
      const thread = store.getQuery(api.threads.get, { threadId });
      if (thread) {
        store.setQuery(
          api.threads.get,
          { threadId },
          { ...thread, modelSwitch: null },
        );
      }
    },
  );
}
