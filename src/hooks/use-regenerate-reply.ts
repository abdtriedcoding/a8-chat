import { useMutation } from "convex/react";
import { throwIfRefused } from "@/lib/errors";
import { api } from "../../convex/_generated/api";
import { browserTimeZone } from "../../convex/lib/timeZone";

/**
 * Replaces the thread's last reply. A refusal throws a ConvexError that
 * errorMessage can show.
 */
export function useRegenerateReply(threadId: string) {
  const regenerateReply = useMutation(api.chat.send.regenerateReply);

  return async () => {
    throwIfRefused(
      await regenerateReply({ threadId, timeZone: browserTimeZone() }),
    );
  };
}
