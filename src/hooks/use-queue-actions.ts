import { useMutation } from "convex/react";
import { throwIfRefused } from "@/lib/errors";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

/** Edits, deletes and resumes the thread's queued prompts. */
export function useQueueActions(threadId: string) {
  const editQueuedPrompt = useMutation(api.chat.queue.editQueuedPrompt);
  const deleteQueuedPrompt = useMutation(api.chat.queue.deleteQueuedPrompt);
  const resumeQueue = useMutation(api.chat.send.resumeQueue);

  return {
    edit: async (queuedPromptId: Id<"queuedPrompts">, prompt: string) => {
      await editQueuedPrompt({ queuedPromptId, prompt });
    },
    remove: async (queuedPromptId: Id<"queuedPrompts">) => {
      await deleteQueuedPrompt({ queuedPromptId });
    },
    resume: async () => {
      throwIfRefused(await resumeQueue({ threadId }));
    },
  };
}
