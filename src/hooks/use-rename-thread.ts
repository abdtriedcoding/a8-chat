import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  patchThread,
  updateListPages,
  updatePinned,
} from "@/lib/optimistic-threads";

export function useRenameThread() {
  return useMutation(api.threads.rename).withOptimisticUpdate(
    (store, { threadId, title }) => {
      const rename = <T extends { _id: string }>(threads: T[]) =>
        threads.map((t) => (t._id === threadId ? { ...t, title } : t));
      updateListPages(store, rename);
      updatePinned(store, rename);
      patchThread(store, threadId, { title });
    },
  );
}
