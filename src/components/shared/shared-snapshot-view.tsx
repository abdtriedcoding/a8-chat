"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { LinkIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { AssistantMessage } from "@/components/chat/assistant-message";
import { ThreadActionsProvider } from "@/components/chat/thread-actions-context";
import { UserMessage } from "@/components/chat/user-message";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { ThreadMessage } from "@/lib/stopped-turns";
import { threadTitle } from "@/lib/thread-title";
import { api } from "../../../convex/_generated/api";

const PAGE_SIZE = 20;

type SharedRow = FunctionReturnType<
  typeof api.sharedSnapshots.listSharedMessages
>["page"][number];

/** Messages here can't be edited, regenerated or approved. */
const READ_ONLY = {
  editingLastPrompt: false,
  setEditingLastPrompt: () => {},
};

/**
 * A shared snapshot's page: the thread's title and its copied messages,
 * oldest first, loading more as the viewer scrolls. Read-only.
 */
export function SharedSnapshotView({ publicId }: { publicId: string }) {
  const snapshot = useQuery(api.sharedSnapshots.getSharedSnapshot, {
    publicId,
  });
  // A new version starts the pages over, since its args change.
  const { results, status, loadMore } = usePaginatedQuery(
    api.sharedSnapshots.listSharedMessages,
    snapshot ? { publicId, version: snapshot.version } : "skip",
    { initialNumItems: PAGE_SIZE },
  );

  if (snapshot === null) return <LinkUnavailable />;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-6">
      {snapshot === undefined || status === "LoadingFirstPage" ? (
        <SharedSkeleton />
      ) : (
        <>
          <h1 className="text-xl font-semibold tracking-tight text-balance">
            {threadTitle(snapshot)}
          </h1>
          <ThreadActionsProvider actions={READ_ONLY}>
            {results.map(toThreadMessage).map((message) =>
              message.role === "user" ? (
                <UserMessage
                  key={message.key}
                  text={message.text}
                  parts={message.parts}
                />
              ) : (
                <AssistantMessage key={message.key} message={message} />
              ),
            )}
          </ThreadActionsProvider>
          {status === "CanLoadMore" && (
            <LoadMoreTrigger onVisible={() => loadMore(PAGE_SIZE)} />
          )}
          {status === "LoadingMore" && (
            <Spinner className="mx-auto" aria-label="Loading more messages" />
          )}
        </>
      )}
    </main>
  );
}

/**
 * A copied message as the chat's message components take it. The snapshot
 * keeps no status, so every message reads as finished.
 */
function toThreadMessage({ _id, message }: SharedRow): ThreadMessage {
  return {
    id: _id,
    key: _id,
    role: message.role,
    order: message.order,
    stepOrder: 0,
    status: "success",
    text: message.text,
    // The snapshot's parts are a subset of the UI message's.
    parts: message.parts as ThreadMessage["parts"],
    _creationTime: 0,
  };
}

/** Loads the next page when it scrolls near the viewport. */
function LoadMoreTrigger({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onVisible();
      },
      { rootMargin: "600px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [onVisible]);
  return <div ref={ref} aria-hidden="true" className="h-px" />;
}

function LinkUnavailable() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LinkIcon />
        </EmptyMedia>
        <EmptyTitle>This link isn&apos;t available</EmptyTitle>
        <EmptyDescription>
          It may have been unshared, or the chat was deleted.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function SharedSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <span role="status" className="sr-only">
        Loading chat…
      </span>
      <Skeleton aria-hidden="true" className="h-7 w-1/2" />
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
