"use client";

import { useConvexAuth, useMutation, usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { MoreHorizontalIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { errorMessage } from "@/lib/errors";
import { threadTitle } from "@/lib/thread-title";
import { api } from "../../convex/_generated/api";

type Thread = FunctionReturnType<typeof api.threads.list>["page"][number];

const PAGE_SIZE = 30;
// Fixed widths: SidebarMenuSkeleton picks random ones, which differ between
// the server render and hydration.
const SKELETON_WIDTHS = ["80%", "65%", "90%", "55%", "70%"];

/** The signed-in user's threads, newest first. */
export function ThreadList() {
  const { isLoading } = useConvexAuth();
  const { results, status, loadMore } = usePaginatedQuery(
    api.threads.list,
    // Wait for auth, or the first page would come back empty (signed out).
    isLoading ? "skip" : {},
    { initialNumItems: PAGE_SIZE },
  );
  const { threadId: activeId } = useParams<{ threadId?: string }>();
  const closeOnMobile = useCloseSidebarOnMobile();
  // Kept after the dialog closes, so its text doesn't blank mid-animation.
  const [target, setTarget] = useState<Thread | null>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Chats</SidebarGroupLabel>
      <SidebarGroupContent>
        {status === "LoadingFirstPage" ? (
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
        ) : results.length === 0 ? (
          <Empty className="p-4">
            <EmptyDescription>
              No chats yet. The ones you start show up here.
            </EmptyDescription>
          </Empty>
        ) : (
          <SidebarMenu>
            {results.map((thread) => {
              const active = thread._id === activeId;
              return (
                <SidebarMenuItem key={thread._id}>
                  <SidebarMenuButton asChild isActive={active}>
                    <Link
                      href={`/c/${thread._id}`}
                      aria-current={active ? "page" : undefined}
                      onClick={closeOnMobile}
                    >
                      <span>{threadTitle(thread)}</span>
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
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => {
                            setTarget(thread);
                            setConfirming(true);
                          }}
                        >
                          <Trash2Icon />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              );
            })}
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
      </SidebarGroupContent>
      <DeleteThreadDialog
        thread={target}
        open={confirming}
        onOpenChange={setConfirming}
        active={target !== null && target._id === activeId}
      />
    </SidebarGroup>
  );
}

function DeleteThreadDialog({
  thread,
  open,
  onOpenChange,
  active,
}: {
  thread: Thread | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  active: boolean;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  // Drop the thread from the loaded pages right away. The server deletes
  // long threads in batches, and the row goes last.
  const removeThread = useMutation(api.threads.remove).withOptimisticUpdate(
    (store, { threadId }) => {
      for (const { args, value } of store.getAllQueries(api.threads.list)) {
        if (!value) continue;
        store.setQuery(api.threads.list, args, {
          ...value,
          page: value.page.filter((t) => t._id !== threadId),
        });
      }
    },
  );

  async function confirmDelete() {
    if (!thread) return;
    setDeleting(true);
    try {
      await removeThread({ threadId: thread._id });
      onOpenChange(false);
      if (active) router.replace("/chat");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!deleting) onOpenChange(next);
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
          <AlertDialogDescription>
            &ldquo;{thread ? threadTitle(thread) : ""}&rdquo; and all its
            messages will be deleted. You can&apos;t undo this.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleting}
            onClick={(event) => {
              // Stay open until the delete lands, so a failure can show.
              event.preventDefault();
              void confirmDelete();
            }}
          >
            {deleting && <Spinner data-icon="inline-start" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
