"use client";

import type { ReactNode } from "react";
import type { ThreadCopy } from "@/hooks/use-thread-queries";
import { useReplyStatus } from "@/hooks/use-reply-status";
import { threadCopyKey, useLocalCopy } from "@/lib/local-copy";
import { stoppedTurns } from "@/lib/stopped-turns";
import { threadTitle } from "@/lib/thread-title";
import { ChatHeader } from "./chat-header";
import { ThreadSkeleton } from "./conversation-skeleton";
import { MessageList } from "./message-list";
import {
  ThreadActionsProvider,
  type ThreadActions,
} from "./thread-actions-context";

const NO_ACTIONS: ThreadActions = {
  editingLastPrompt: false,
  setEditingLastPrompt: () => {},
};
const OFFLINE: ThreadActions = { ...NO_ACTIONS, offline: true };

/**
 * A thread from the device's copy (lib/local-copy), where the thread view
 * can't show it yet: the app's skeleton before the Convex client starts
 * (`beforeSignIn`), and the thread page while the router loads it. Its
 * messages do nothing, and `composer` goes where the Composer does. With no
 * copy, it's ThreadSkeleton.
 */
export function ThreadCopyPreview({
  threadId,
  composer,
  beforeSignIn = false,
}: {
  threadId: string;
  composer: (copy: ThreadCopy) => ReactNode;
  beforeSignIn?: boolean;
}) {
  const copy = useLocalCopy<ThreadCopy>(threadCopyKey(threadId), {
    beforeSignIn,
  });
  if (!copy) return <ThreadSkeleton />;
  return <Preview copy={copy} composer={composer} offline={beforeSignIn} />;
}

function Preview({
  copy,
  composer,
  offline,
}: {
  copy: ThreadCopy;
  composer: (copy: ThreadCopy) => ReactNode;
  offline: boolean;
}) {
  const stopped = stoppedTurns(copy.messages);
  const replyStatus = useReplyStatus(copy.messages, stopped);
  return (
    <>
      <ChatHeader>
        {/* Sized like ThreadHeading's rename button. */}
        <h1 className="min-w-0 flex-1 text-sm font-medium">
          <span className="block h-8 max-w-full truncate border border-transparent px-2 leading-[30px]">
            {threadTitle(copy.thread)}
          </span>
        </h1>
      </ChatHeader>
      <ThreadActionsProvider actions={offline ? OFFLINE : NO_ACTIONS}>
        <MessageList
          messages={copy.messages}
          status={copy.hasEarlier ? "CanLoadMore" : "Exhausted"}
          onLoadEarlier={() => {}}
          stopped={stopped}
          replyStatus={replyStatus}
        />
      </ThreadActionsProvider>
      <div className="shrink-0 px-4 pb-4">{composer(copy)}</div>
    </>
  );
}
