import { useMutation } from "convex/react";
import type { UploadedAttachment } from "@/hooks/use-composer-attachments";
import { throwIfRefused } from "@/lib/errors";
import { optimisticallySendPrompt } from "@/lib/optimistic-prompt";
import { api } from "../../convex/_generated/api";
import { browserTimeZone } from "../../convex/lib/timeZone";

/**
 * Sends a prompt, which shows in the thread before the server has it. A
 * refused send throws a ConvexError that errorMessage can show.
 */
export function useSendPrompt(threadId: string) {
  const sendMessage = useMutation(api.chat.send.sendMessage);

  return async (prompt: string, attachments: UploadedAttachment[]) => {
    // Set up for each Send, since the optimistic prompt shows the
    // attachments' URLs, and the mutation only takes their IDs.
    const sendWithOptimisticPrompt = sendMessage.withOptimisticUpdate(
      (localStore) =>
        optimisticallySendPrompt(localStore, {
          threadId,
          prompt,
          attachments,
        }),
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
