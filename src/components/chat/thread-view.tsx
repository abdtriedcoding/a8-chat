"use client";

import { useUIMessages } from "@convex-dev/agent/react";
import { useConvexAuth, useQuery } from "convex/react";
import { MessageSquareOffIcon } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useThreadShortcuts } from "@/components/keyboard-shortcuts";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useStableMessages } from "@/hooks/use-stable-messages";
import { useThreadActions } from "@/hooks/use-thread-actions";
import { useThreadState } from "@/hooks/use-thread-state";
import { errorMessage } from "@/lib/errors";
import { api } from "../../../convex/_generated/api";
import { DecideActionProvider } from "./action-card";
import { ChatHeader, ThreadHeading } from "./chat-header";
import { Composer } from "./composer";
import { MessageList } from "./message-list";

const PAGE_SIZE = 20;

export function ThreadView({ threadId }: { threadId: string }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const thread = useQuery(api.threads.get, isLoading ? "skip" : { threadId });

  const {
    results: rawMessages,
    status,
    loadMore,
  } = useUIMessages(
    api.chat.messages.listThreadMessages,
    isAuthenticated ? { threadId } : "skip",
    { initialNumItems: PAGE_SIZE, stream: true },
  );

  const { send, stop, regenerate, edit, decide } = useThreadActions(threadId);

  const messages = useStableMessages(rawMessages);
  const threadState = useThreadState(messages);
  const { replyInProgress, canRedoLastTurn, lastReplyText } = threadState;

  // Whether the last prompt's editor is open. It closes when the prompt
  // can't be edited anymore, for example when another tab sends a new prompt.
  const [editingLastPrompt, setEditingLastPrompt] = useState(false);
  if (!canRedoLastTurn && editingLastPrompt) setEditingLastPrompt(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Set when ↑ in the message box opened the editor, so closing it puts the
  // focus back there.
  const editOpenedByKey = useRef(false);

  function changeEditingLastPrompt(editing: boolean, byKey = false) {
    if (editing) {
      editOpenedByKey.current = byKey;
    } else if (editOpenedByKey.current) {
      editOpenedByKey.current = false;
      composerRef.current?.focus();
    }
    setEditingLastPrompt(editing);
  }

  useThreadShortcuts({
    stopReply: replyInProgress
      ? () => {
          stop().catch((error: unknown) => toast.error(errorMessage(error)));
        }
      : undefined,
    editLastPrompt: canRedoLastTurn
      ? () => changeEditingLastPrompt(true, true)
      : undefined,
    copyLastReply: lastReplyText
      ? () => void copyReply(lastReplyText)
      : undefined,
  });

  if (thread === null) {
    return (
      <>
        <ChatHeader />
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquareOffIcon />
            </EmptyMedia>
            <EmptyTitle>Chat not found</EmptyTitle>
            <EmptyDescription>
              It may have been deleted, or the link is wrong.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href="/chat">Start a new chat</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </>
    );
  }

  return (
    <>
      <ChatHeader>
        {thread && <ThreadHeading threadId={threadId} title={thread.title} />}
      </ChatHeader>
      {thread === undefined || status === "LoadingFirstPage" ? (
        <ConversationSkeleton />
      ) : (
        <DecideActionProvider decide={decide}>
          <MessageList
            messages={messages}
            status={status}
            onLoadEarlier={() => loadMore(PAGE_SIZE)}
            threadState={threadState}
            onRegenerate={canRedoLastTurn ? regenerate : undefined}
            onEdit={canRedoLastTurn ? edit : undefined}
            editingLastPrompt={editingLastPrompt}
            onEditingLastPromptChange={changeEditingLastPrompt}
          />
        </DecideActionProvider>
      )}
      <div className="shrink-0 px-4 pb-4">
        <Composer
          onSend={send}
          onStop={replyInProgress ? stop : undefined}
          disabled={replyInProgress}
          autoFocus
          textareaRef={composerRef}
          className="mx-auto max-w-3xl"
        />
      </div>
    </>
  );
}

async function copyReply(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied the last reply.");
  } catch {
    toast.error("Couldn't copy the reply.");
  }
}

function ConversationSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-6">
      <span role="status" className="sr-only">
        Loading chat…
      </span>
      <Skeleton aria-hidden="true" className="h-10 w-2/5 self-end rounded-xl" />
      <div aria-hidden="true" className="flex gap-2">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <div className="flex flex-1 flex-col gap-2 pt-1.5">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  );
}
