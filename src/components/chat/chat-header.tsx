"use client";

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function ChatHeader({ title }: { title?: string }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <SidebarTrigger />
      {title && (
        <>
          <Separator orientation="vertical" className="data-[orientation=vertical]:h-4" />
          <h1 className="min-w-0 truncate text-sm font-medium">{title}</h1>
        </>
      )}
    </header>
  );
}
