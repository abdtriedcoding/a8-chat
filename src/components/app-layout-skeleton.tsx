"use client";

import { GhostIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { AppSidebarSkeleton } from "@/components/app-sidebar";
import { ChatHeader } from "@/components/chat/chat-header";
import { ComposerSkeleton } from "@/components/chat/composer-skeleton";
import {
  NEW_CHAT_COMPOSER_CLASS,
  NewChatFrame,
} from "@/components/chat/new-chat-frame";
import { ThreadCopyPreview } from "@/components/chat/thread-copy-preview";
import { Button } from "@/components/ui/button";
import { SidebarInset } from "@/components/ui/sidebar";

/** The headings of the chat pages that have one, by path. */
const PAGE_HEADINGS: Record<string, string> = {
  "/archived": "Archived chats",
  "/connectors": "Connectors",
  "/scheduled": "Scheduled tasks",
  "/settings/account": "Account",
  "/settings/billing": "Billing",
};

/**
 * The chat layout while it waits for the Convex token: the sidebar, and the
 * current page's header and message box in outline, where the app puts them.
 * The sidebar and a thread show from the device's copy when it has one,
 * and the placeholders show only if it hasn't filled them in by then.
 * It renders inside the layout's SidebarProvider, so it opens or closes the
 * sidebar the same as the app.
 */
export function AppLayoutSkeleton() {
  return (
    // Its placeholders wait a moment before they show (globals.css). The
    // wrapper takes no box, so the sidebar and inset stay siblings.
    <div data-delay-skeletons className="contents">
      <AppSidebarSkeleton />
      <SidebarInset className="min-w-0">
        <PageSkeleton pathname={usePathname()} />
      </SidebarInset>
    </div>
  );
}

function PageSkeleton({ pathname }: { pathname: string }) {
  if (pathname === "/chat") {
    return (
      <NewChatFrame
        temporary={false}
        title="Hello."
        titleReady={false}
        headerEnd={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Temporary chat"
            disabled
          >
            <GhostIcon />
          </Button>
        }
      >
        <ComposerSkeleton className={NEW_CHAT_COMPOSER_CLASS} />
      </NewChatFrame>
    );
  }
  if (pathname.startsWith("/c/")) {
    return (
      <ThreadCopyPreview
        threadId={pathname.slice("/c/".length)}
        beforeSignIn
        composer={() => <ComposerSkeleton className="mx-auto max-w-3xl" />}
      />
    );
  }
  const heading = PAGE_HEADINGS[pathname];
  return (
    <ChatHeader>
      {heading && <h1 className="px-2 text-sm font-medium">{heading}</h1>}
    </ChatHeader>
  );
}
