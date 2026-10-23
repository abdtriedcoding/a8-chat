import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { patchThread } from "@/lib/optimistic-threads";

/** Hides the note about a thread's last model switch, right away. */
export function useDismissModelSwitch() {
  return useMutation(api.models.dismissModelSwitch).withOptimisticUpdate(
    (store, { threadId }) => {
      patchThread(store, threadId, { modelSwitch: null });
    },
  );
}
