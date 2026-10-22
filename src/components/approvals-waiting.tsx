"use client";

import { useQuery } from "convex-helpers/react/cache/hooks";
import { CircleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCloseSidebarOnMobile } from "@/hooks/use-close-sidebar-on-mobile";
import { api } from "../../convex/_generated/api";

/** The color of everything that says a chat waits on the user. */
const APPROVAL_COLOR = "text-amber-600 dark:text-amber-400";

/**
 * The mark on a sidebar row whose last reply stopped at an action card.
 * It must be inside the row's link, which reads it as part of its name.
 */
export function NeedsApprovalMarker() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="ml-auto flex shrink-0">
          <CircleAlertIcon aria-hidden="true" className={APPROVAL_COLOR} />
          <span className="sr-only">Needs your approval</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">Needs your approval</TooltipContent>
    </Tooltip>
  );
}

/**
 * The row above the chat list that counts the chats waiting on an approval.
 * It opens the one waiting longest, skipping the open chat when another
 * one waits.
 */
export function ApprovalsWaiting() {
  const waiting = useQuery(api.pendingActions.listMine, {});
  const { threadId: activeId } = useParams<{ threadId?: string }>();
  const closeOnMobile = useCloseSidebarOnMobile();
  if (!waiting || waiting.length === 0) return null;

  const target =
    waiting.find((thread) => thread.threadId !== activeId) ?? waiting[0];
  const label =
    waiting.length === 1
      ? "1 chat needs approval"
      : `${waiting.length} chats need approval`;
  return (
    <SidebarGroup className="pb-0">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            className="bg-amber-500/10 font-medium text-amber-800 hover:bg-amber-500/15 hover:text-amber-800 active:bg-amber-500/15 active:text-amber-800 dark:text-amber-300 dark:hover:text-amber-300 dark:active:text-amber-300"
          >
            <Link href={`/c/${target.threadId}`} onClick={closeOnMobile}>
              <CircleAlertIcon aria-hidden="true" className={APPROVAL_COLOR} />
              <span>{label}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
