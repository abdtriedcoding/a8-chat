import { useMutation } from "convex/react";
import { useConfirm } from "@/hooks/use-confirm";
import {
  updateListPages,
  updatePinned,
  without,
} from "@/lib/optimistic-threads";
import { threadTitle } from "@/lib/thread-title";
import { api } from "../../convex/_generated/api";

/**
 * Asks before deleting a thread. `deleteThread` resolves true once it's
 * deleted. Render `dialog` once in the component that calls it. The button
 * that opened the dialog may go with the thread, so `returnFocus` names
 * where focus goes after.
 */
export function useDeleteThread() {
  const [dialog, confirm] = useConfirm();
  // Drops the thread from the loaded pages right away. The server deletes
  // long threads in batches, and the row goes last.
  const removeThread = useMutation(api.threads.remove).withOptimisticUpdate(
    (store, { threadId }) => {
      updateListPages(store, without(threadId));
      updatePinned(store, without(threadId));
    },
  );

  function deleteThread(
    thread: { _id: string; title?: string },
    returnFocus?: () => HTMLElement | null,
  ) {
    return confirm({
      title: "Delete this chat?",
      description: (
        <>
          &ldquo;{threadTitle(thread)}&rdquo; and all its messages will be
          deleted. You can&apos;t undo this.
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
      onConfirm: () => removeThread({ threadId: thread._id }),
      returnFocus,
    });
  }

  return [dialog, deleteThread] as const;
}
