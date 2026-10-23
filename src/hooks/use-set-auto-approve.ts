import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { patchThread } from "@/lib/optimistic-threads";

/** Turns a thread's auto-approve on or off. The chip changes right away. */
export function useSetAutoApprove() {
  return useMutation(api.autoApprove.setAutoApprove).withOptimisticUpdate(
    (store, { threadId, on }) => {
      patchThread(store, threadId, { autoApprove: on });
    },
  );
}
