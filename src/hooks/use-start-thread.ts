import { useMutation } from "convex/react";
import type { UploadedAttachment } from "@/hooks/use-composer-attachments";
import { throwIfRefused } from "@/lib/errors";
import { api } from "../../convex/_generated/api";
import { browserTimeZone } from "../../convex/lib/timeZone";

/**
 * Starts a thread with its first prompt, for the new-chat page, which has no
 * thread yet. Returns the new thread's ID, or throws if the Send was refused.
 */
export function useStartThread() {
  const startThread = useMutation(api.chat.send.startThread);

  return async function start(
    prompt: string,
    attachments: UploadedAttachment[],
  ) {
    const { threadId } = throwIfRefused(
      await startThread({
        prompt,
        attachmentFileIds: attachments.map(({ fileId }) => fileId),
        timeZone: browserTimeZone(),
      }),
    );
    return threadId;
  };
}
