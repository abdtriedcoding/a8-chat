"use client";

import { PlugIcon, SquarePenIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";
import { NavUser } from "@/components/nav-user";
import { ThreadList } from "@/components/thread-list";
import { ThreadSearchButton } from "@/components/thread-search";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useCloseSidebarOnMobile } from "@/hooks/use-close-sidebar-on-mobile";

export function AppSidebar() {
  const closeOnMobile = useCloseSidebarOnMobile();
  const onConnectorsPage = usePathname() === "/connectors";
  return (
    <Sidebar>
      <SidebarHeader className="gap-3">
        <Link
          href="/chat"
          aria-label="a8, new chat"
          onClick={closeOnMobile}
          className="self-start rounded-md px-2 pt-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Logo className="text-lg" />
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
              aria-current={onConnectorsPage ? "page" : undefined}
              onClick={closeOnMobile}
            >
              <PlugIcon data-icon="inline-start" />
              Connectors
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
