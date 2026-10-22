"use client";

import { useQuery } from "convex-helpers/react/cache/hooks";
import {
  ArchiveIcon,
  CalendarClockIcon,
  PlugIcon,
  SquarePenIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppIcon } from "@/components/icons/app-icon";
import { NavUser } from "@/components/nav-user";
import { ThreadList } from "@/components/thread-list";
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
import { api } from "../../convex/_generated/api";

export function AppSidebar() {
  const closeOnMobile = useCloseSidebarOnMobile();
  const pathname = usePathname();
  const unreadRuns = useQuery(api.scheduledPrompts.unreadCount, {});
  return (
    <Sidebar>
      <SidebarHeader className="gap-3">
        <Link
          href="/chat"
          aria-label="a8, new chat"
          onClick={closeOnMobile}
          className="self-start rounded-md px-2 pt-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <AppIcon />
        </Link>
        <div className="flex flex-col gap-1">
          <Button variant="outline" className="justify-start" asChild>
            <Link href="/chat" onClick={closeOnMobile}>
              <SquarePenIcon data-icon="inline-start" />
              New chat
            </Link>
          </Button>
          <ThreadSearchButton />
          <Button
            variant="ghost"
            className="justify-start aria-[current=page]:bg-muted"
            asChild
          >
            <Link
              href="/connectors"
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
              aria-current={pathname === "/scheduled" ? "page" : undefined}
              onClick={closeOnMobile}
            >
              <CalendarClockIcon data-icon="inline-start" />
              Scheduled
              {(unreadRuns ?? 0) > 0 && (
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
              aria-current={pathname === "/archived" ? "page" : undefined}
              onClick={closeOnMobile}
            >
              <ArchiveIcon data-icon="inline-start" />
              Archived
            </Link>
          </Button>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <ThreadList />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
