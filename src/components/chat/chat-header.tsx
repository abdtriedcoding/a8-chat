"use client";

import { cn } from "cn";
import { GhostIcon, SquarePenIcon } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { ThreadTitleInput } from "@/components/thread-title-input";
import { Badge } from "@/components/ui/badge";
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

/** A temporary thread's heading in the ChatHeader. */
export function TemporaryHeading() {
  return (
    <h1 className="min-w-0 flex-1 px-2">
      <Badge variant="secondary">
        <GhostIcon data-icon="inline-start" />
        Temporary
      </Badge>
    </h1>
  );
}

/**
 * The bar above a chat. `children` go after the sidebar button, and `end`
 * at the far end.
 */
export function ChatHeader({
  children,
  end,
  className,
}: {
  children?: ReactNode;
  end?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 border-b px-3",
        className,
      )}
    >
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
      <div className="ml-auto flex items-center gap-2">
        {end}
        <Button variant="outline" size="icon-sm" className="md:hidden" asChild>
          <Link href="/chat" prefetch aria-label="New chat">
            <SquarePenIcon />
          </Link>
        </Button>
      </div>
    </header>
  );
}

/**
 * The thread's title as the page heading, sized like ThreadHeading, for a
 * thread shown from the device's copy that can't be renamed yet.
 */
export function StaticThreadHeading({ title }: { title?: string }) {
  return (
    <h1 className="min-w-0 flex-1 text-sm font-medium">
      <span className="block h-8 max-w-full truncate border border-transparent px-2 leading-[30px]">
        {threadTitle({ title })}
      </span>
    </h1>
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
  // Set when a rename closes with Enter or Esc, which leaves focus nowhere.
  // The title button takes it back when it mounts.
  const refocusTitle = useRef(false);
  const renameThread = useRenameThread();

  return (
    <h1 className="min-w-0 flex-1 text-sm font-medium">
      {editing ? (
        <ThreadTitleInput
          title={title}
          onSave={(next) => renameThread({ threadId, title: next })}
          onClose={(byKey) => {
            refocusTitle.current = byKey;
            setEditing(false);
          }}
          className="max-w-md"
        />
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              ref={(button) => {
                if (button && refocusTitle.current) {
                  refocusTitle.current = false;
                  button.focus();
                }
              }}
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
