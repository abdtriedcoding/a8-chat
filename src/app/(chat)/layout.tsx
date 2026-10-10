import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { KeyboardShortcutsProvider } from "@/components/keyboard-shortcuts";
import { SessionGuard } from "@/components/session-guard";
import { ThreadSearchProvider } from "@/components/thread-search";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getToken } from "@/lib/auth-server";
import { ConvexClientProvider } from "../ConvexClientProvider";

export default async function ChatLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Every page in this group is signed-in only. This is the one place that
  // fetches the Convex token, so the landing and auth pages never do.
  const token = await getToken();
  if (!token) redirect("/sign-in");
  const defaultOpen =
    (await cookies()).get("sidebar_state")?.value !== "false";
  return (
    <ConvexClientProvider initialToken={token}>
      <SessionGuard />
      <SidebarProvider defaultOpen={defaultOpen} className="h-svh">
        <ThreadSearchProvider>
          <KeyboardShortcutsProvider>
            <AppSidebar />
            <SidebarInset className="min-w-0">{children}</SidebarInset>
          </KeyboardShortcutsProvider>
        </ThreadSearchProvider>
      </SidebarProvider>
    </ConvexClientProvider>
  );
}
