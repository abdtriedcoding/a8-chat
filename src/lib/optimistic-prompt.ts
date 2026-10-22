import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
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
  const messagesQuery = api.chat.messages.listThreadMessages;

  // The new prompt's turn comes after every turn on screen.
  let highestOrderOnScreen = -1;
  for (const { args, value } of localStore.getAllQueries(messagesQuery)) {
    if (args.threadId !== threadId || args.streamArgs) continue;
    for (const message of value?.page ?? []) {
      highestOrderOnScreen = Math.max(highestOrderOnScreen, message.order);
    }
  }
  const newPromptOrder = highestOrderOnScreen + 1;

  const item = promptMessage({
    key: `${threadId}-${newPromptOrder}-0`,
    order: newPromptOrder,
    prompt,
    attachments,
  });
  // insertAtTop updates only one first page. This updates all of them,
  // since the query cache can hold two: the one on screen, which gets an end
  // cursor once earlier messages load, and the cached one without it.
  for (const { args, value } of localStore.getAllQueries(messagesQuery)) {
    if (
      args.threadId !== threadId ||
      args.streamArgs ||
      args.paginationOpts.cursor !== null ||
      value === undefined
    ) {
      continue;
    }
    localStore.setQuery(messagesQuery, args, {
      ...value,
      page: [item, ...value.page],
    });
  }
}

/**
 * A prompt as listThreadMessages returns it, before the server saves it.
 * `key` is the one the saved prompt gets.
 */
export function promptMessage({
  key,
  order,
  prompt,
  attachments,
}: {
  key: string;
  order: number;
  prompt: string;
  attachments: UploadedAttachment[];
}): FunctionReturnType<
  typeof api.chat.messages.listThreadMessages
>["page"][number] {
  // The server saves the text trimmed.
  const trimmedText = prompt.trim();
  return {
    id: crypto.randomUUID(),
    _creationTime: Date.now(),
    key,
    order,
    stepOrder: 0,
    status: "pending",
    role: "user",
    text: trimmedText,
    parts: [
      ...attachments.map(({ fileUrl, mediaType, filename }) => ({
        type: "file" as const,
        url: fileUrl,
        mediaType,
        filename,
      })),
      ...(trimmedText ? [{ type: "text" as const, text: trimmedText }] : []),
    ],
  };
}

const OPTIMISTIC_ID_PREFIX = "optimistic-";

/**
 * Whether the queued prompt is one optimisticallyQueuePrompt shows, which
 * the server hasn't saved yet, so it can't be edited or deleted.
 */
export function isOptimisticQueuedPrompt(id: Id<"queuedPrompts">): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX);
}

/**
 * Shows a prompt at the end of the thread's queue stack before the server
 * queues it.
 */
export function optimisticallyQueuePrompt(
  localStore: OptimisticLocalStore,
  {
    threadId,
    prompt,
    attachments,
  }: { threadId: string; prompt: string; attachments: UploadedAttachment[] },
) {
  const queueQuery = api.chat.queue.getQueue;
  const queue = localStore.getQuery(queueQuery, { threadId });
  if (!queue) return;
  localStore.setQuery(
    queueQuery,
    { threadId },
    {
      ...queue,
      prompts: [
        ...queue.prompts,
        {
          // Never sent to the server. The stack swaps in the saved prompt
          // once the Send returns.
          _id: `${OPTIMISTIC_ID_PREFIX}${crypto.randomUUID()}` as Id<"queuedPrompts">,
          _creationTime: Date.now(),
          // The server saves the text trimmed.
          prompt: prompt.trim(),
          attachmentCount: attachments.length,
        },
      ],
    },
  );
}
