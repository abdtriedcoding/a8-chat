import { useMutation } from "convex/react";
import type { UploadedAttachment } from "@/hooks/use-composer-attachments";
import { throwIfRefused } from "@/lib/errors";
import {
  optimisticallyQueuePrompt,
  optimisticallySendPrompt,
} from "@/lib/optimistic-prompt";
import { api } from "../../convex/_generated/api";
import { browserTimeZone } from "../../convex/lib/timeZone";

/**
 * Sends a prompt, which shows before the server has it: in the thread, or
 * with `shouldQueue`, in the queue stack. The server decides whether the
 * prompt goes right away or joins the queue, and the screen follows once
 * it answers. A refused send throws a ConvexError that errorMessage can show.
 */
export function useSendPrompt(threadId: string, shouldQueue: boolean) {
  const sendMessage = useMutation(api.chat.send.sendMessage);

  return async (prompt: string, attachments: UploadedAttachment[]) => {
    // Set up for each Send, since the optimistic prompt shows the
    // attachments' URLs, and the mutation only takes their IDs.
    const showPrompt = shouldQueue
      ? optimisticallyQueuePrompt
      : optimisticallySendPrompt;
    const sendWithOptimisticPrompt = sendMessage.withOptimisticUpdate(
      (localStore) => showPrompt(localStore, { threadId, prompt, attachments }),
    );
    throwIfRefused(
      await sendWithOptimisticPrompt({
        threadId,
        prompt,
        attachmentFileIds: attachments.map(({ fileId }) => fileId),
        timeZone: browserTimeZone(),
      }),
    );
  };
}
