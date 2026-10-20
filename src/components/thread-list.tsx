"use client";

import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
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
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
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
import { useRemoveThread } from "@/hooks/use-remove-thread";
import { useRenameThread } from "@/hooks/use-rename-thread";
import { useSetThreadArchived } from "@/hooks/use-set-thread-archived";
import { useSetThreadPinned } from "@/hooks/use-set-thread-pinned";
import { errorMessage } from "@/lib/errors";
import { threadTitle } from "@/lib/thread-title";
import { api } from "../../convex/_generated/api";

type Thread = FunctionReturnType<typeof api.threads.list>["page"][number];

const PAGE_SIZE = 30;
const SKELETON_WIDTHS = ["80%", "65%", "90%", "55%", "70%"];

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

export function ThreadList() {
  const { isAuthenticated } = useConvexAuth();
  const { results, status, loadMore } = usePaginatedQuery(
    api.threads.list,
    isAuthenticated ? {} : "skip",
    { initialNumItems: PAGE_SIZE },
  );
  const pinned = useQuery(
    api.threads.listPinned,
    isAuthenticated ? {} : "skip",
  );
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
        <SidebarMenuButton asChild isActive={active}>
          <Link
            href={`/c/${thread._id}`}
            aria-current={active ? "page" : undefined}
            onClick={closeOnMobile}
          >
            <span className="truncate">{threadTitle(thread)}</span>
            {/* A scheduled run the user hasn't opened the thread to see. */}
            {thread.unread && (
              <span className="ml-auto size-2 shrink-0 rounded-full bg-primary">
                <span className="sr-only">Unread</span>
              </span>
            )}
          </Link>
        </SidebarMenuButton>
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
      </SidebarMenuItem>
    );
  }

  const loading = status === "LoadingFirstPage" || pinned === undefined;
  const chatsEmpty = results.length === 0 && status === "Exhausted";
  const hasPins = pinned !== undefined && pinned.length > 0;

  return (
    <>
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
            <SidebarMenu aria-hidden="true">
              {SKELETON_WIDTHS.map((width) => (
                <SidebarMenuItem
                  key={width}
                  className="flex h-8 items-center px-2"
                >
                  <Skeleton className="h-4" style={{ width }} />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          ) : chatsEmpty ? (
            <Empty className="p-4">
              <EmptyDescription>
                No chats yet. The ones you start show up here.
              </EmptyDescription>
            </Empty>
          ) : (
            <SidebarMenu>
              {results.map((thread) => renderThread(thread, false))}
              {status !== "Exhausted" && (
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
