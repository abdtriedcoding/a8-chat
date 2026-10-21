import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * Sets a thread's model from the picker. The chip changes right away, and
 * the note about an earlier switch goes away.
 */
export function useSetThreadModel() {
  return useMutation(api.models.setThreadModel).withOptimisticUpdate(
    (store, { threadId, modelId }) => {
      const thread = store.getQuery(api.threads.get, { threadId });
      if (thread) {
        store.setQuery(
          api.threads.get,
          { threadId },
          { ...thread, modelId, modelSwitch: null },
        );
      }
    },
  );
}
