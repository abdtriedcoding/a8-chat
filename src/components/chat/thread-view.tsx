"use client";

import {
  optimisticallySendMessage,
  useUIMessages,
} from "@convex-dev/agent/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { MessageSquareOffIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
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
import { browserTimeZone } from "@/lib/time-zone";
import { api } from "../../../convex/_generated/api";
import { ChatHeader } from "./chat-header";
import { Composer } from "./composer";
import { MessageList } from "./message-list";

const PAGE_SIZE = 20;
// How long "Thinking…" waits for a reply to start before giving up on it.
const STALE_AFTER_MS = 60_000;

export function ThreadView({ threadId }: { threadId: string }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const thread = useQuery(api.threads.get, isLoading ? "skip" : { threadId });
  // Whether this thread was ever shown here, so that one deleted while open
  // (from the sidebar or another tab) isn't reported as "not found".
  const [seen, setSeen] = useState(false);
  if (thread && !seen) setSeen(true);

  const { results: messages, status, loadMore } = useUIMessages(
    api.chat.listThreadMessages,
    // It throws for a thread that isn't the viewer's, so wait for threads.get.
    thread && isAuthenticated ? { threadId } : "skip",
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

  const last = messages.at(-1);
  // The prompt is saved, but the Agent hasn't started the reply.
  const awaitingKey = last?.role === "user" ? last.key : null;
  const stale = useStaleAfter(awaitingKey, STALE_AFTER_MS);
  const replying =
    last?.role === "assistant" &&
    (last.status === "pending" || last.status === "streaming");
  const busy = (awaitingKey !== null && !stale) || replying;

  if (thread === null) {
    return (
      <>
        <ChatHeader />
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquareOffIcon />
            </EmptyMedia>
            <EmptyTitle>
              {seen ? "This chat was deleted" : "Chat not found"}
            </EmptyTitle>
            <EmptyDescription>
              {seen
                ? "It and its messages are gone."
                : "It may have been deleted, or the link is wrong."}
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

  // The composer renders while loading too, in the same place in the tree,
  // so it keeps focus and anything typed once the messages arrive.
  return (
    <>
      <ChatHeader title={thread ? thread.title || "Untitled chat" : undefined} />
      {thread === undefined || status === "LoadingFirstPage" ? (
        <ConversationSkeleton />
      ) : (
        <MessageList
          messages={messages}
          status={status}
          onLoadEarlier={() => loadMore(PAGE_SIZE)}
          pendingReply={awaitingKey !== null ? { stale } : null}
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
          busy={busy}
          autoFocus
          className="mx-auto max-w-3xl"
        />
      </div>
    </>
  );
}

/**
 * True once `key` has stayed the same for `ms`; a new key starts over. The
 * clock starts when this client first sees the key, not at the message's
 * server timestamp, since the two clocks can disagree.
 */
function useStaleAfter(key: string | null, ms: number): boolean {
  const [staleKey, setStaleKey] = useState<string | null>(null);
  useEffect(() => {
    if (key === null) return;
    // setState in a timer callback, not the effect body (a React Compiler rule).
    const timeout = setTimeout(() => setStaleKey(key), ms);
    return () => clearTimeout(timeout);
  }, [key, ms]);
  return key !== null && staleKey === key;
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
