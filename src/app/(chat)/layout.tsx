import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { KeyboardShortcutsProvider } from "@/components/keyboard-shortcuts";
import { ThreadSearchProvider } from "@/components/thread-search";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default async function ChatLayout({
  children,
}: {
  children: ReactNode;
}) {
  const defaultOpen =
    (await cookies()).get("sidebar_state")?.value !== "false";
  return (
    <SidebarProvider defaultOpen={defaultOpen} className="h-svh">
      <ThreadSearchProvider>
        <KeyboardShortcutsProvider>
          <AppSidebar />
          <SidebarInset className="min-w-0">{children}</SidebarInset>
        </KeyboardShortcutsProvider>
      </ThreadSearchProvider>
    </SidebarProvider>
  );
}
