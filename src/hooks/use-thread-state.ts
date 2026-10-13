import {
  type ConnectorToolCall,
  connectorToolCalls,
  isWaitingForApproval,
} from "@/components/chat/connector-tool-call";
import { type ReplyStatus, useReplyStatus } from "@/hooks/use-reply-status";
import { replyText } from "@/lib/reply-text";
import { stoppedTurns, type ThreadMessage } from "@/lib/stopped-turns";

/** What a reply shows, worked out from its message. */
export type ReplyParts = {
  text: string;
  /** Its connector tool calls, in the order the model made them. */
  toolCalls: ConnectorToolCall[];
  /** The actions whose cards show. */
  waitingActions: ConnectorToolCall[];
  /** The calls that show as rows: every call without a card. */
  toolRows: ConnectorToolCall[];
};

export type ThreadState = {
  /**
   * The orders of the turns the user stopped. A streaming reply carries no
   * metadata, so this keeps "Stopped" showing while the stream aborts.
   */
  stopped: Set<number>;
  replyStatus: ReplyStatus;
  /** Whether a reply is being waited on or written. */
  replyInProgress: boolean;
  /** Whether the last turn can be regenerated or its prompt edited. */
  canRedoLastTurn: boolean;
  /** Each reply's parts, by message id. */
  replies: Map<string, ReplyParts>;
  /**
   * The text Copy under the last reply copies. Empty while the reply is
   * being written.
   */
  lastReplyText: string;
  /** The actions in the thread whose cards show. */
  waitingActions: ConnectorToolCall[];
};

/** The state of a thread, from its messages (oldest first). */
export function useThreadState(messages: ThreadMessage[]): ThreadState {
  const stopped = stoppedTurns(messages);
  const replyStatus = useReplyStatus(messages, stopped);
  const replyInProgress =
    replyStatus === "waiting" ||
    replyStatus === "continuing" ||
    replyStatus === "streaming";
  // A stopped turn counts as done, and so does a reply that timed out.
  const canRedoLastTurn = messages.length > 0 && !replyInProgress;

  const replies = new Map<string, ReplyParts>();
  let lastReplyText = "";
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const text = replyText(message);
    const toolCalls = connectorToolCalls(message);
    const replyStopped = stopped.has(message.order);
    // A stopped reply can't continue, so its waiting actions show as rows.
    const waitingActions = replyStopped
      ? []
      : toolCalls.filter(isWaitingForApproval);
    replies.set(message.id, {
      text,
      toolCalls,
      waitingActions,
      toolRows: toolCalls.filter((call) => !waitingActions.includes(call)),
    });
    lastReplyText = copyableText(message, text, replyStopped);
  }

  return {
    stopped,
    replyStatus,
    replyInProgress,
    canRedoLastTurn,
    replies,
    lastReplyText,
    waitingActions: [...replies.values()].flatMap(
      ({ waitingActions }) => waitingActions,
    ),
  };
}

/**
 * The text Copy under a reply copies: none while the reply is still being
 * written. A stopped reply keeps the text it had.
 */
function copyableText(reply: ThreadMessage, text: string, stopped: boolean) {
  const writing = reply.status === "pending" || reply.status === "streaming";
  return writing && !stopped ? "" : text;
}
