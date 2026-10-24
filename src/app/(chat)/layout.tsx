import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AppLayoutSkeleton } from "@/components/app-layout-skeleton";
import { AppSidebar } from "@/components/app-sidebar";
import { ApprovalAlerts } from "@/components/approval-alerts";
import { KeyboardShortcutsProvider } from "@/components/keyboard-shortcuts";
import { SessionGuard } from "@/components/session-guard";
import { SkipLink } from "@/components/skip-link";
import { TemporaryThreadProvider } from "@/components/temporary-thread";
import { ThreadSearchProvider } from "@/components/thread-search";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getToken } from "@/lib/auth-server";
import {
  ConvexClientProvider,
  ConvexPreconnect,
} from "../ConvexClientProvider";

export default async function ChatLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Every page in this group is signed-in only, and proxy.ts sends a visitor
  // with no session cookie to /sign-in. The layout renders on a full page
  // load, not on navigation between chat pages, so this reads the Convex
  // token once.
  //
  // It isn't awaited. With an expired token cookie it's a fetch of about
  // 0.8s, and the skeleton streams meanwhile. With no session, or a failed
  // fetch, it gives null. Then the client fetches a token itself, and
  // SessionGuard sends the visitor to /sign-in if there's no session.
  const tokenPromise = getToken().then(
    (token) => token ?? null,
    () => null,
  );
  const defaultOpen =
    (await cookies()).get("sidebar_state")?.value !== "false";
  return (
    // Outside the boundary, so the sidebar stays open or closed as the user
    // left it in the skeleton.
    <SidebarProvider defaultOpen={defaultOpen} className="h-svh">
      <SkipLink />
      <ConvexPreconnect />
      <ConvexClientProvider
        tokenPromise={tokenPromise}
        fallback={<AppLayoutSkeleton />}
      >
        <SessionGuard />
        <ApprovalAlerts />
        <TemporaryThreadProvider>
          <ThreadSearchProvider>
            <KeyboardShortcutsProvider>
              <AppSidebar />
              <SidebarInset className="min-w-0">{children}</SidebarInset>
            </KeyboardShortcutsProvider>
          </ThreadSearchProvider>
        </TemporaryThreadProvider>
      </ConvexClientProvider>
    </SidebarProvider>
  );
}
