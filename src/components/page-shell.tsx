import type { ReactNode } from "react";
import { ChatHeader } from "@/components/chat/chat-header";

/** A page from the sidebar: its title in the header, over a scrolling column. */
export function PageShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <ChatHeader>
        <h1 className="px-2 text-sm font-medium">{title}</h1>
      </ChatHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
          {children}
        </div>
      </div>
    </>
  );
}
