"use client";

import type { ReactNode } from "react";
import type { ThreadCopy } from "@/hooks/use-thread-queries";
import { useReplyStatus } from "@/hooks/use-reply-status";
import { threadCopyKey, useLocalCopy } from "@/lib/local-copy";
import { stoppedTurns } from "@/lib/stopped-turns";
import { ChatHeader, StaticThreadHeading } from "./chat-header";
import { ThreadSkeleton } from "./conversation-skeleton";
import { MessageList } from "./message-list";
import {
  READ_ONLY_ACTIONS,
  ThreadActionsProvider,
} from "./thread-actions-context";

/**
 * A thread from the device's copy (lib/local-copy), while the router loads
 * the thread page. Its messages do nothing, and `composer` goes where the
 * Composer does. With no copy, it's ThreadSkeleton.
 */
export function ThreadCopyPreview({
  threadId,
  composer,
}: {
  threadId: string;
  composer: (copy: ThreadCopy) => ReactNode;
}) {
  const copy = useLocalCopy<ThreadCopy>(threadCopyKey(threadId));
  if (!copy) return <ThreadSkeleton />;
  return <Preview copy={copy} composer={composer} />;
}

function Preview({
  copy,
  composer,
}: {
  copy: ThreadCopy;
  composer: (copy: ThreadCopy) => ReactNode;
}) {
  const stopped = stoppedTurns(copy.messages);
  const replyStatus = useReplyStatus(copy.messages, stopped);
  return (
    <>
      <ChatHeader>
        <StaticThreadHeading title={copy.thread.title} />
      </ChatHeader>
      <ThreadActionsProvider actions={READ_ONLY_ACTIONS}>
        <MessageList
          messages={copy.messages}
          status={copy.hasEarlier ? "CanLoadMore" : "Exhausted"}
          stopped={stopped}
          replyStatus={replyStatus}
        />
      </ThreadActionsProvider>
      <div className="shrink-0 px-4 pb-4">{composer(copy)}</div>
    </>
  );
}
