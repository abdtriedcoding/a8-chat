import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { patchThread } from "@/lib/optimistic-threads";

/**
 * Sets a thread's model from the picker. The chip changes right away, and
 * the note about an earlier switch goes away.
 */
export function useSetThreadModel() {
  return useMutation(api.models.setThreadModel).withOptimisticUpdate(
    (store, { threadId, modelId }) => {
      patchThread(store, threadId, { modelId, modelSwitch: null });
    },
  );
}
