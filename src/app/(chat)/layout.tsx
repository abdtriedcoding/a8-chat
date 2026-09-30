import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

// No auth check here: layouts don't re-render on navigation, so each page
// guards itself.
export default async function ChatLayout({
  children,
}: {
  children: ReactNode;
}) {
  // The sidebar saves its open state in this cookie. Reading it on the server
  // renders the right state first, so a collapsed sidebar doesn't flash open.
  const defaultOpen =
    (await cookies()).get("sidebar_state")?.value !== "false";
  return (
    // A fixed-height shell, so only the message list scrolls.
    <SidebarProvider defaultOpen={defaultOpen} className="h-svh">
      <AppSidebar />
      <SidebarInset className="min-w-0">{children}</SidebarInset>
    </SidebarProvider>
  );
}
