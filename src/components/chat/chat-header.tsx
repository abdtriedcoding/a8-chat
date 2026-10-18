"use client";

import { SquarePenIcon } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ThreadTitleInput } from "@/components/thread-title-input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRenameThread } from "@/hooks/use-rename-thread";
import { threadTitle } from "@/lib/thread-title";

/** The bar above a chat. `children` go after the sidebar button. */
export function ChatHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <SidebarTrigger variant="outline" />
      {children && (
        <>
          <Separator
            orientation="vertical"
            className="data-vertical:h-4 data-vertical:self-auto"
          />
          {children}
        </>
      )}
      <Button
        variant="outline"
        size="icon-sm"
        className="ml-auto md:hidden"
        asChild
      >
        <Link href="/chat" aria-label="New chat">
          <SquarePenIcon />
        </Link>
      </Button>
    </header>
  );
}

/** The thread's title as the page heading. Clicking it renames the thread. */
export function ThreadHeading({
  threadId,
  title,
}: {
  threadId: string;
  title?: string;
}) {
  const [editing, setEditing] = useState(false);
  const renameThread = useRenameThread();

  return (
    <h1 className="min-w-0 flex-1 text-sm font-medium">
      {editing ? (
        <ThreadTitleInput
          title={title}
          onSave={(next) => renameThread({ threadId, title: next })}
          onClose={() => setEditing(false)}
          className="max-w-md"
        />
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="block h-8 max-w-full truncate rounded-md border border-transparent px-2 text-left outline-none hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {threadTitle({ title })}
            </button>
          </TooltipTrigger>
          <TooltipContent>Rename</TooltipContent>
        </Tooltip>
      )}
    </h1>
  );
}
