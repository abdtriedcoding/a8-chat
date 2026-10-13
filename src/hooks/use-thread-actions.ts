import { useMutation } from "convex/react";
import type { UploadedAttachment } from "@/hooks/use-composer-attachments";
import { throwIfRefused } from "@/lib/errors";
import { optimisticallySendPrompt } from "@/lib/optimistic-prompt";
import { api } from "../../convex/_generated/api";
import { browserTimeZone } from "../../convex/lib/timeZone";

/**
 * The chat mutations on one thread. Those that take a time zone get the
 * browser's, and a refused send, regenerate or edit throws a ConvexError that
 * errorMessage can show.
 */
export function useThreadActions(threadId: string) {
  const sendMessage = useMutation(api.chat.send.sendMessage);
  const stopReply = useMutation(api.chat.stop.stopReply);
  const regenerateReply = useMutation(api.chat.send.regenerateReply);
  const editPrompt = useMutation(api.chat.send.editPrompt);
  const decideAction = useMutation(api.chat.approval.decideAction);

  /** Sends a prompt, which shows in the thread before the server has it. */
  async function send(prompt: string, attachments: UploadedAttachment[]) {
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
  }

  async function stop() {
    await stopReply({ threadId });
  }

  async function regenerate() {
    throwIfRefused(
      await regenerateReply({ threadId, timeZone: browserTimeZone() }),
    );
  }

  async function edit(prompt: string) {
    throwIfRefused(
      await editPrompt({ threadId, prompt, timeZone: browserTimeZone() }),
    );
  }

  async function decide(approvalId: string, approve: boolean) {
    await decideAction({
      threadId,
      approvalId,
      approve,
      timeZone: browserTimeZone(),
    });
  }

  return { send, stop, regenerate, edit, decide };
}
