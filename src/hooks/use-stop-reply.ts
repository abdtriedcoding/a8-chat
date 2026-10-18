import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

/** Stops the reply the thread is writing. */
export function useStopReply(threadId: string) {
  const stopReply = useMutation(api.chat.stop.stopReply);

  return async () => {
    await stopReply({ threadId });
  };
}
