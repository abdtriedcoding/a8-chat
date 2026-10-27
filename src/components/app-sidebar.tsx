"use client";

import {
  ArchiveIcon,
  CalendarClockIcon,
  CircleAlertIcon,
  PlugIcon,
  SearchIcon,
  SquarePenIcon,
} from "lucide-react";
import { catchError, type ErrorInfo } from "next/error";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { AppIcon } from "@/components/icons/app-icon";
import { NavUser, NavUserSkeleton } from "@/components/nav-user";
import { ThreadList, ThreadListSkeleton } from "@/components/thread-list";
import { ThreadSearchButton } from "@/components/thread-search";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useSignInOnUnauthenticated } from "@/components/session-guard";
import { useCloseSidebarOnMobile } from "@/hooks/use-close-sidebar-on-mobile";
import { useQueryWithLocalCopy } from "@/hooks/use-query-with-local-copy";
import { errorMessage } from "@/lib/errors";
import { api } from "../../convex/_generated/api";

/**
 * The sidebar, in its own error boundary. The layout renders it outside the
 * pages' error.tsx, so without one a failed sidebar query would reach the
 * root error.tsx and replace the whole app. A failure shows in place of the
 * chat list instead, and the page stays.
 */
export function AppSidebar() {
  return (
    <SidebarBoundary>
      <LiveSidebar />
    </SidebarBoundary>
  );
}

const SidebarBoundary = catchError(SidebarError);

function SidebarError(_props: object, { error, retry }: ErrorInfo) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const signedOut = useSignInOnUnauthenticated(error);
  return (
    <StaticSidebar
      threads={
        signedOut ? null : (
          <Empty className="p-4">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleAlertIcon />
              </EmptyMedia>
              <EmptyTitle className="text-sm">Chats couldn&apos;t load</EmptyTitle>
              <EmptyDescription>{errorMessage(error)}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={retry}>
                Try again
              </Button>
            </EmptyContent>
          </Empty>
        )
      }
    />
  );
}

function LiveSidebar() {
  const { data: unreadRuns } = useQueryWithLocalCopy(
    api.scheduledPrompts.unreadCount,
    {},
  );
  return (
    <SidebarFrame
      search={<ThreadSearchButton />}
      unreadRuns={unreadRuns ?? 0}
      threads={<ThreadList />}
      user={<NavUser />}
    />
  );
}

/**
 * The sidebar before the app has its Convex token, the same size as
 * AppSidebar. Its links work, and search waits for the app.
 */
export function AppSidebarSkeleton() {
  return <StaticSidebar threads={<ThreadListSkeleton />} />;
}

/** The sidebar with no queries in it, and `threads` in the chat list's place. */
function StaticSidebar({ threads }: { threads: ReactNode }) {
  return (
    <SidebarFrame
      search={
        <Button variant="ghost" className="justify-start" disabled>
          <SearchIcon data-icon="inline-start" />
          Search chats
        </Button>
      }
      unreadRuns={0}
      threads={threads}
      user={<NavUserSkeleton />}
    />
  );
}

function SidebarFrame({
  search,
  unreadRuns,
  threads,
  user,
}: {
  search: ReactNode;
  unreadRuns: number;
  threads: ReactNode;
  user: ReactNode;
}) {
  const closeOnMobile = useCloseSidebarOnMobile();
  const pathname = usePathname();
  return (
    <Sidebar>
      <SidebarHeader className="gap-3">
        <Link
          href="/chat"
          prefetch
          aria-label="a8, new chat"
          onClick={closeOnMobile}
          className="self-start rounded-md px-2 pt-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <AppIcon />
        </Link>
        <div className="flex flex-col gap-1">
          <Button variant="outline" className="justify-start" asChild>
            <Link href="/chat" prefetch onClick={closeOnMobile}>
              <SquarePenIcon data-icon="inline-start" />
              New chat
            </Link>
          </Button>
          {search}
          <Button
            variant="ghost"
            className="justify-start aria-[current=page]:bg-muted"
            asChild
          >
            <Link
              href="/connectors"
              prefetch
              aria-current={pathname === "/connectors" ? "page" : undefined}
              onClick={closeOnMobile}
            >
              <PlugIcon data-icon="inline-start" />
              Connectors
            </Link>
          </Button>
          <Button
            variant="ghost"
            className="justify-start aria-[current=page]:bg-muted"
            asChild
          >
            <Link
              href="/scheduled"
              prefetch
              aria-current={pathname === "/scheduled" ? "page" : undefined}
              onClick={closeOnMobile}
            >
              <CalendarClockIcon data-icon="inline-start" />
              Scheduled
              {unreadRuns > 0 && (
                <Badge className="ml-auto tabular-nums">
                  {unreadRuns}
                  <span className="sr-only">
                    {unreadRuns === 1 ? " unread run" : " unread runs"}
                  </span>
                </Badge>
              )}
            </Link>
          </Button>
          <Button
            variant="ghost"
            className="justify-start aria-[current=page]:bg-muted"
            asChild
          >
            <Link
              href="/archived"
              prefetch
              aria-current={pathname === "/archived" ? "page" : undefined}
              onClick={closeOnMobile}
            >
              <ArchiveIcon data-icon="inline-start" />
              Archived
            </Link>
          </Button>
        </div>
      </SidebarHeader>
      <SidebarContent>{threads}</SidebarContent>
      <SidebarFooter>{user}</SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
