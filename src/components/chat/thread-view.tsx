"use client";

import {
  optimisticallySendMessage,
  useUIMessages,
} from "@convex-dev/agent/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { MessageSquareOffIcon } from "lucide-react";
import Link from "next/link";
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
import { useReplyStatus } from "@/hooks/use-reply-status";
import { browserTimeZone } from "@/lib/time-zone";
import { api } from "../../../convex/_generated/api";
import { ChatHeader, ThreadHeading } from "./chat-header";
import { Composer } from "./composer";
import { MessageList } from "./message-list";

const PAGE_SIZE = 20;

export function ThreadView({ threadId }: { threadId: string }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const thread = useQuery(api.threads.get, isLoading ? "skip" : { threadId });

  const {
    results: messages,
    status,
    loadMore,
  } = useUIMessages(
    api.chat.listThreadMessages,
    isAuthenticated ? { threadId } : "skip",
    { initialNumItems: PAGE_SIZE, stream: true },
  );

  const sendMessage = useMutation(api.chat.sendMessage).withOptimisticUpdate(
    // Passes only these two: the helper copies any other argument onto the
    // optimistic message.
    (store, { threadId, prompt }) =>
      optimisticallySendMessage(api.chat.listThreadMessages)(store, {
        threadId,
        prompt,
      }),
  );

  const stopReply = useMutation(api.chat.stopReply);
  const regenerateReply = useMutation(api.chat.regenerateReply);
  const editPrompt = useMutation(api.chat.editPrompt);

  const replyStatus = useReplyStatus(messages);
  const replyInProgress =
    replyStatus === "waiting" || replyStatus === "streaming";
  const last = messages.at(-1);
  // The last turn can be regenerated or edited while no reply is in
  // progress. A stopped turn counts as done, and so does a reply that timed
  // out.
  const canRedoLastTurn = last !== undefined && !replyInProgress;

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
        <MessageList
          messages={messages}
          status={status}
          onLoadEarlier={() => loadMore(PAGE_SIZE)}
          replyStatus={replyStatus}
          onRegenerate={
            canRedoLastTurn
              ? async () => {
                  await regenerateReply({
                    threadId,
                    timeZone: browserTimeZone(),
                  });
                }
              : undefined
          }
          onEdit={
            canRedoLastTurn
              ? async (prompt) => {
                  await editPrompt({
                    threadId,
                    prompt,
                    timeZone: browserTimeZone(),
                  });
                }
              : undefined
          }
        />
      )}
      <div className="shrink-0 px-4 pb-4">
        <Composer
          onSend={async (prompt) => {
            await sendMessage({
              threadId,
              prompt,
              timeZone: browserTimeZone(),
            });
          }}
          onStop={
            replyInProgress
              ? async () => {
                  // Keep the reply's text only if some is on screen. If the
                  // user stopped during "Thinking…", the reply is hidden.
                  const keepText =
                    last?.role === "assistant" && last.text !== "";
                  await stopReply({ threadId, keepText });
                }
              : undefined
          }
          disabled={replyInProgress}
          autoFocus
          className="mx-auto max-w-3xl"
        />
      </div>
    </>
  );
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
