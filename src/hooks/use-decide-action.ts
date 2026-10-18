import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { browserTimeZone } from "../../convex/lib/timeZone";

/** Approves or cancels the action waiting on the card with this approval ID. */
export function useDecideAction(threadId: string) {
  const decideAction = useMutation(api.chat.approval.decideAction);

  return async (approvalId: string, approve: boolean) => {
    await decideAction({
      threadId,
      approvalId,
      approve,
      timeZone: browserTimeZone(),
    });
  };
}
