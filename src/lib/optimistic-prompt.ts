import type { OptimisticLocalStore } from "convex/browser";
import { insertAtTop } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { UploadedAttachment } from "@/hooks/use-composer-attachments";

/**
 * Shows a prompt at the end of the thread before the server saves it. It
 * does what the Agent's optimisticallySendMessage does, and also shows the
 * prompt's attachments.
 */
export function optimisticallySendPrompt(
  localStore: OptimisticLocalStore,
  {
    threadId,
    prompt,
    attachments,
  }: { threadId: string; prompt: string; attachments: UploadedAttachment[] },
) {
  const messagesQuery = api.chat.listThreadMessages;

  // The new prompt's turn comes after every turn on screen.
  let highestOrderOnScreen = -1;
  for (const { args, value } of localStore.getAllQueries(messagesQuery)) {
    if (args.threadId !== threadId || args.streamArgs) continue;
    for (const message of value?.page ?? []) {
      highestOrderOnScreen = Math.max(highestOrderOnScreen, message.order);
    }
  }
  const newPromptOrder = highestOrderOnScreen + 1;

  // The server saves the text trimmed.
  const trimmedText = prompt.trim();
  insertAtTop({
    paginatedQuery: messagesQuery,
    argsToMatch: { threadId, streamArgs: undefined },
    item: {
      id: crypto.randomUUID(),
      _creationTime: Date.now(),
      key: `${threadId}-${newPromptOrder}-0`,
      order: newPromptOrder,
      stepOrder: 0,
      status: "pending",
      role: "user",
      text: trimmedText,
      parts: [
        ...attachments.map(({ fileUrl, mediaType }) => ({
          type: "file" as const,
          url: fileUrl,
          mediaType,
        })),
        ...(trimmedText ? [{ type: "text" as const, text: trimmedText }] : []),
      ],
    },
    localQueryStore: localStore,
  });
}
