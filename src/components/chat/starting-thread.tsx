"use client";

import { useParams } from "next/navigation";
import {
  useClearStartingThreadOnLeave,
  useStartingThread,
} from "@/lib/starting-threads";
import type { ThreadMessage } from "@/lib/stopped-turns";
import { ChatHeader, TemporaryHeading } from "./chat-header";
import { Composer } from "./composer";
import { ThreadSkeleton } from "./conversation-skeleton";
import { MessageList } from "./message-list";
import {
  ThreadActionsProvider,
  type ThreadActions,
} from "./thread-actions-context";

// The server hasn't saved the prompt, so it can't be edited yet.
const NO_ACTIONS: ThreadActions = {
  editingLastPrompt: false,
  setEditingLastPrompt: () => {},
};
const NO_STOPPED_TURNS = new Set<number>();

/**
 * A new thread's first prompt and "Thinking…", as the thread view shows
 * them, before the thread's messages load.
 */
export function StartingThreadMessages({ prompt }: { prompt: ThreadMessage }) {
  return (
    <ThreadActionsProvider actions={NO_ACTIONS}>
      <MessageList
        messages={[prompt]}
        status="Exhausted"
        onLoadEarlier={() => {}}
        stopped={NO_STOPPED_TURNS}
        replyStatus="waiting"
      />
    </ThreadActionsProvider>
  );
}

/**
 * The thread page while the router loads it. A thread the new-chat page
 * just started shows as the new-chat page left it, and any other thread
 * shows the skeleton. The Composer is a real one, turned off, so its chips
 * match the new-chat page's and the thread view's.
 */
export function ThreadPageLoading() {
  const { threadId } = useParams<{ threadId: string }>();
  const starting = useStartingThread(threadId);
  useClearStartingThreadOnLeave(threadId);
  if (!starting) return <ThreadSkeleton />;
  return (
    <>
      <ChatHeader>{starting.temporary && <TemporaryHeading />}</ChatHeader>
      <StartingThreadMessages prompt={starting.prompt} />
      <div className="shrink-0 px-4 pb-4">
        <Composer
          onSend={async () => {}}
          disabled
          autoApprove={starting.autoApprove}
          onAutoApproveChange={() => {}}
          modelId={starting.modelId}
          onModelChange={() => {}}
          className="mx-auto max-w-3xl"
        />
      </div>
    </>
  );
}
