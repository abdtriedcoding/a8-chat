import { useMutation } from "convex/react";
import { throwIfRefused } from "@/lib/errors";
import { api } from "../../convex/_generated/api";
import { browserTimeZone } from "../../convex/lib/timeZone";

/**
 * Edits the thread's last prompt and redoes its reply. A refusal throws a
 * ConvexError that errorMessage can show.
 */
export function useEditPrompt(threadId: string) {
  const editPrompt = useMutation(api.chat.send.editPrompt);

  return async (prompt: string) => {
    throwIfRefused(
      await editPrompt({ threadId, prompt, timeZone: browserTimeZone() }),
    );
  };
}
