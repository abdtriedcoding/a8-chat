"use client";

import {
  ArchiveIcon,
  CalendarClockIcon,
  PlugIcon,
  SearchIcon,
  SquarePenIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppIcon } from "@/components/icons/app-icon";
import { NavUser, NavUserPreview } from "@/components/nav-user";
import { ThreadList, ThreadListPreview } from "@/components/thread-list";
import { ThreadSearchButton } from "@/components/thread-search";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useCloseSidebarOnMobile } from "@/hooks/use-close-sidebar-on-mobile";
import {
  queryCopyKey,
  useQueryWithLocalCopy,
} from "@/hooks/use-query-with-local-copy";
import { useLocalCopy } from "@/lib/local-copy";
import { api } from "../../convex/_generated/api";

export function AppSidebar() {
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
 * AppSidebar. Its links work, and search waits for the app. Chats, the badge
 * and the account come from the device's copy when it has one.
 */
export function AppSidebarSkeleton() {
  const unreadRuns = useLocalCopy<number>(
    queryCopyKey(api.scheduledPrompts.unreadCount, {}),
    { beforeSignIn: true },
  );
  return (
    <SidebarFrame
      search={
        <Button variant="ghost" className="justify-start" disabled>
          <SearchIcon data-icon="inline-start" />
          Search chats
        </Button>
      }
      unreadRuns={unreadRuns ?? 0}
      threads={<ThreadListPreview />}
      user={<NavUserPreview />}
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
