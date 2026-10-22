"use client";

import { usePaginatedQuery } from "convex-helpers/react/cache/hooks";
import type { FunctionReturnType } from "convex/server";
import { ArchiveIcon, ArchiveRestoreIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useConfirm } from "@/hooks/use-confirm";
import { useRemoveThread } from "@/hooks/use-remove-thread";
import { useSetThreadArchived } from "@/hooks/use-set-thread-archived";
import { errorMessage } from "@/lib/errors";
import { threadTitle } from "@/lib/thread-title";
import { api } from "../../convex/_generated/api";

type Thread = FunctionReturnType<typeof api.threads.list>["page"][number];

const PAGE_SIZE = 30;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** The user's archived threads, each with Unarchive and Delete. */
export function ArchivedThreadList() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.threads.list,
    { archived: true },
    { initialNumItems: PAGE_SIZE },
  );
  const setThreadArchived = useSetThreadArchived();
  const removeThread = useRemoveThread();
  const [confirmDialog, confirm] = useConfirm();

  function unarchiveThread(thread: Thread) {
    setThreadArchived({ threadId: thread._id, archived: false }).catch(
      (error: unknown) => toast.error(errorMessage(error)),
    );
  }

  async function deleteThread(thread: Thread) {
    await confirm({
      title: "Delete this chat?",
      description: (
        <>
          &ldquo;{threadTitle(thread)}&rdquo; and all its messages will be
          deleted. You can&apos;t undo this.
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
      onConfirm: () => removeThread({ threadId: thread._id }),
    });
  }

  if (status === "LoadingFirstPage") {
    return (
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (results.length === 0 && status === "Exhausted") {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ArchiveIcon />
          </EmptyMedia>
          <EmptyTitle>No archived chats</EmptyTitle>
          <EmptyDescription>
            Chats you archive from the sidebar show up here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y rounded-lg border">
        {results.map((thread) => (
          <li
            key={thread._id}
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            <div className="flex min-w-0 flex-col">
              <Link
                href={`/c/${thread._id}`}
                className="truncate text-sm font-medium underline-offset-4 hover:underline"
              >
                {threadTitle(thread)}
              </Link>
              <span className="text-xs text-muted-foreground">
                Started {dateFormat.format(thread._creationTime)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => unarchiveThread(thread)}
              >
                <ArchiveRestoreIcon data-icon="inline-start" />
                Unarchive
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-destructive hover:text-destructive"
                aria-label={`Delete ${threadTitle(thread)}`}
                onClick={() => void deleteThread(thread)}
              >
                <Trash2Icon />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {status !== "Exhausted" && (
        <Button
          variant="ghost"
          className="self-center"
          disabled={status === "LoadingMore"}
          onClick={() => loadMore(PAGE_SIZE)}
        >
          {status === "LoadingMore" && <Spinner data-icon="inline-start" />}
          Load more
        </Button>
      )}
      {confirmDialog}
    </div>
  );
}
