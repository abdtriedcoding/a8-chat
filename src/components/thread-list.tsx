"use client";

import type { FunctionReturnType } from "convex/server";
import {
  ArchiveIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  Share2Icon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type ComponentProps, type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ApprovalsWaiting,
  NeedsApprovalMarker,
} from "@/components/approvals-waiting";
import { ShareDialog } from "@/components/share-dialog";
import { ThreadTitleInput } from "@/components/thread-title-input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useCloseSidebarOnMobile } from "@/hooks/use-close-sidebar-on-mobile";
import { useConfirm } from "@/hooks/use-confirm";
import {
  queryCopyKey,
  usePaginatedQueryWithLocalCopy,
  useQueryWithLocalCopy,
} from "@/hooks/use-query-with-local-copy";
import { useRemoveThread } from "@/hooks/use-remove-thread";
import { useRenameThread } from "@/hooks/use-rename-thread";
import { useSetThreadArchived } from "@/hooks/use-set-thread-archived";
import { useSetThreadPinned } from "@/hooks/use-set-thread-pinned";
import { useThreadQueries } from "@/hooks/use-thread-queries";
import { errorMessage } from "@/lib/errors";
import { useLocalCopy } from "@/lib/local-copy";
import { threadTitle } from "@/lib/thread-title";
import { api } from "../../convex/_generated/api";

type Thread = FunctionReturnType<typeof api.threads.list>["page"][number];

const PAGE_SIZE = 30;
const SKELETON_WIDTHS = ["80%", "65%", "90%", "55%", "70%"];
// How long the pointer stays on a thread before it starts loading. A pointer
// moving down the list stays on each thread for less.
const PREFETCH_HOVER_MS = 100;

/**
 * Subscribes to a thread's queries before it opens, and renders nothing.
 * After it unmounts, the query cache keeps them for the thread view.
 */
function PrefetchThread({ threadId }: { threadId: string }) {
  useThreadQueries(threadId, { stream: false });
  return null;
}

/** A sidebar section whose label shows and hides its threads. */
function ThreadSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen className="group/section">
      <SidebarGroup>
        <SidebarGroupLabel
          asChild
          className="cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <CollapsibleTrigger>
            {label}
            <ChevronRightIcon className="ml-auto transition-transform group-data-[state=open]/section:rotate-90" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>{children}</SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

/** The thread list as it looks while its first page loads. */
export function ThreadListSkeleton() {
  return (
    <ThreadSection label="Chats">
      <ThreadRowsSkeleton />
    </ThreadSection>
  );
}

/**
 * The thread list from the device's copy (lib/local-copy), for the app's
 * skeleton before the Convex client starts. Its rows open their threads and
 * have no menus. With no copy, it's ThreadListSkeleton.
 */
export function ThreadListPreview() {
  const chats = useLocalCopy<Thread[]>(queryCopyKey(api.threads.list, {}), {
    beforeSignIn: true,
  });
  const pinned = useLocalCopy<Thread[]>(
    queryCopyKey(api.threads.listPinned, {}),
    { beforeSignIn: true },
  );
  const { threadId: activeId } = useParams<{ threadId?: string }>();
  const closeOnMobile = useCloseSidebarOnMobile();
  if (chats === undefined) return <ThreadListSkeleton />;
  const rows = (threads: Thread[]) => (
    <SidebarMenu>
      {threads.map((thread) => (
        <SidebarMenuItem key={thread._id}>
          <ThreadLink
            thread={thread}
            active={thread._id === activeId}
            onClick={closeOnMobile}
          />
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
  return (
    <>
      {pinned && pinned.length > 0 && (
        <ThreadSection label="Pinned">{rows(pinned)}</ThreadSection>
      )}
      {chats.length > 0 && (
        <ThreadSection label="Chats">{rows(chats)}</ThreadSection>
      )}
    </>
  );
}

/** A sidebar row's link to its thread, with its approval mark or unread dot. */
function ThreadLink({
  thread,
  active,
  ...props
}: {
  thread: Thread;
  active: boolean;
} & Omit<ComponentProps<typeof Link>, "href">) {
  return (
    <SidebarMenuButton asChild isActive={active}>
      <Link
        href={`/c/${thread._id}`}
        aria-current={active ? "page" : undefined}
        {...props}
      >
        <span className="truncate">{threadTitle(thread)}</span>
        {/* A waiting action card outranks the dot for an unread scheduled run. */}
        {thread.needsApproval ? (
          <NeedsApprovalMarker />
        ) : (
          thread.unread && (
            <span className="ml-auto size-2 shrink-0 rounded-full bg-primary">
              <span className="sr-only">Unread</span>
            </span>
          )
        )}
      </Link>
    </SidebarMenuButton>
  );
}

function ThreadRowsSkeleton() {
  return (
    <SidebarMenu aria-hidden="true">
      {SKELETON_WIDTHS.map((width) => (
        <SidebarMenuItem key={width} className="flex h-8 items-center px-2">
          <Skeleton className="h-4" style={{ width }} />
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

export function ThreadList() {
  // Until the first page loads, the device's copy of it shows, stale.
  const {
    results,
    status,
    loadMore,
    stale: chatsStale,
  } = usePaginatedQueryWithLocalCopy(
    api.threads.list,
    {},
    { initialNumItems: PAGE_SIZE },
  );
  const { data: pinned, stale: pinnedStale } = useQueryWithLocalCopy(
    api.threads.listPinned,
    {},
  );
  // A row from the copy opens its thread, but its menu waits for live data.
  const stale = chatsStale || pinnedStale;
  const { threadId: activeId } = useParams<{ threadId?: string }>();
  const closeOnMobile = useCloseSidebarOnMobile();
  const renameThread = useRenameThread();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [sharing, setSharing] = useState<Thread | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const router = useRouter();
  const removeThread = useRemoveThread();
  const setThreadArchived = useSetThreadArchived();
  const setThreadPinned = useSetThreadPinned();
  const [prefetchId, setPrefetchId] = useState<string | null>(null);
  const prefetchTimer = useRef<number | undefined>(undefined);
  // Opening a page ends the prefetch. A thread opened with the keyboard
  // fires no pointerleave, so its prefetch would otherwise stay mounted.
  const [prefetchPage, setPrefetchPage] = useState(activeId);
  if (prefetchPage !== activeId) {
    setPrefetchPage(activeId);
    setPrefetchId(null);
  }

  function prefetchSoon(threadId: string) {
    window.clearTimeout(prefetchTimer.current);
    prefetchTimer.current = window.setTimeout(
      () => setPrefetchId(threadId),
      PREFETCH_HOVER_MS,
    );
  }

  function prefetchNow(threadId: string) {
    window.clearTimeout(prefetchTimer.current);
    setPrefetchId(threadId);
  }

  function stopPrefetch() {
    window.clearTimeout(prefetchTimer.current);
    setPrefetchId(null);
  }

  function setPinned(thread: Thread, pinned: boolean) {
    setThreadPinned({ threadId: thread._id, pinned }).catch((error: unknown) =>
      toast.error(errorMessage(error)),
    );
  }

  async function archiveThread(thread: Thread) {
    const threadId = thread._id;
    try {
      await setThreadArchived({ threadId, archived: true });
    } catch (error) {
      toast.error(errorMessage(error));
      return;
    }
    toast.success(`Archived “${threadTitle(thread)}”.`, {
      action: {
        label: "Undo",
        onClick: () => {
          setThreadArchived({ threadId, archived: false }).catch(
            (error: unknown) => toast.error(errorMessage(error)),
          );
        },
      },
    });
  }

  async function deleteThread(thread: Thread) {
    const confirmed = await confirm({
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
    if (confirmed && thread._id === activeId) router.replace("/chat");
  }

  function renderThread(thread: Thread, isPinned: boolean) {
    if (thread._id === renamingId) {
      return (
        <SidebarMenuItem key={thread._id}>
          <ThreadTitleInput
            title={thread.title}
            onSave={(title) => renameThread({ threadId: thread._id, title })}
            onClose={() => setRenamingId(null)}
            className="bg-background shadow-none"
          />
        </SidebarMenuItem>
      );
    }
    const active = thread._id === activeId;
    return (
      <SidebarMenuItem key={thread._id}>
        <ThreadLink
          thread={thread}
          active={active}
          onClick={closeOnMobile}
          onPointerEnter={() => prefetchSoon(thread._id)}
          onPointerLeave={stopPrefetch}
          onNavigate={() => prefetchNow(thread._id)}
        />
        {!stale && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuAction showOnHover>
                <MoreHorizontalIcon />
                <span className="sr-only">
                  More options for {threadTitle(thread)}
                </span>
              </SidebarMenuAction>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => setPinned(thread, !isPinned)}>
                  {isPinned ? <PinOffIcon /> : <PinIcon />}
                  {isPinned ? "Unpin" : "Pin"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSharing(thread)}>
                  <Share2Icon />
                  Share
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setRenamingId(thread._id)}>
                  <PencilIcon />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void archiveThread(thread)}>
                  <ArchiveIcon />
                  Archive
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => void deleteThread(thread)}
                >
                  <Trash2Icon />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SidebarMenuItem>
    );
  }

  // Without a copy, Chats waits for the pins too, so Pinned doesn't push it
  // down when it loads.
  const loading =
    !chatsStale && (status === "LoadingFirstPage" || pinned === undefined);
  // A copy is saved empty only when the list was.
  const chatsEmpty =
    results.length === 0 && (status === "Exhausted" || chatsStale);
  const hasPins = pinned !== undefined && pinned.length > 0;

  return (
    <>
      <ApprovalsWaiting />
      {prefetchId && <PrefetchThread key={prefetchId} threadId={prefetchId} />}
      {hasPins && (
        <ThreadSection label="Pinned">
          <SidebarMenu>
            {pinned.map((thread) => renderThread(thread, true))}
          </SidebarMenu>
        </ThreadSection>
      )}
      {/* With every thread pinned, there's nothing to show under Chats. */}
      {!(chatsEmpty && hasPins) && (
        <ThreadSection label="Chats">
          {loading ? (
            <ThreadRowsSkeleton />
          ) : chatsEmpty ? (
            <Empty className="p-4">
              <EmptyDescription>
                No chats yet. The ones you start show up here.
              </EmptyDescription>
            </Empty>
          ) : (
            <SidebarMenu>
              {results.map((thread) => renderThread(thread, false))}
              {!stale && status !== "Exhausted" && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    className="text-muted-foreground"
                    disabled={status === "LoadingMore"}
                    onClick={() => loadMore(PAGE_SIZE)}
                  >
                    {status === "LoadingMore" && <Spinner />}
                    <span>Load more</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          )}
        </ThreadSection>
      )}
      {confirmDialog}
      {sharing && (
        <ShareDialog
          threadId={sharing._id}
          title={sharing.title}
          open
          onOpenChange={(open) => {
            if (!open) setSharing(null);
          }}
        />
      )}
    </>
  );
}
