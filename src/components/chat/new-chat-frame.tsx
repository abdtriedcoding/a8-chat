import { cn } from "cn";
import { GhostIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ChatHeader, TemporaryHeading } from "./chat-header";
import { SkyBackdrop } from "./sky-backdrop";

/** The new-chat page's classes for its Composer. */
export const NEW_CHAT_COMPOSER_CLASS =
  "w-full max-w-2xl *:data-[slot=input-group]:rounded-xl *:data-[slot=input-group]:border-white/60 *:data-[slot=input-group]:shadow-[0_12px_40px_-12px_rgb(30_58_138/0.45)] dark:*:data-[slot=input-group]:border-white/15 dark:*:data-[slot=input-group]:bg-card/75 dark:*:data-[slot=input-group]:shadow-[0_12px_40px_-12px_rgb(0_0_0/0.6)] dark:*:data-[slot=input-group]:backdrop-blur-xl";

/**
 * The new-chat page around its Composer (`children`): the sky, the header,
 * and the greeting. A title that isn't ready stays hidden but keeps
 * its space.
 *
 * With `messages`, the page takes the thread view's layout instead: the
 * header, the messages, and the Composer under them. The Composer keeps
 * its place in the tree, so it stays mounted, with its text and
 * attachments, when the layout switches.
 */
export function NewChatFrame({
  temporary,
  title,
  titleReady,
  headerEnd,
  messages,
  children,
}: {
  temporary: boolean;
  title: string;
  titleReady: boolean;
  /** Shown with the greeting only. */
  headerEnd: ReactNode;
  messages?: ReactNode;
  children: ReactNode;
}) {
  const showsMessages = messages !== undefined;
  return (
    <div className="relative isolate flex min-h-0 flex-1 flex-col">
      {!showsMessages && <SkyBackdrop className="absolute inset-0 -z-10" />}
      {showsMessages ? (
        <ChatHeader>{temporary && <TemporaryHeading />}</ChatHeader>
      ) : (
        <ChatHeader className="border-transparent" end={headerEnd} />
      )}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          !showsMessages &&
            "items-center justify-center gap-8 overflow-y-auto px-4 pb-16",
        )}
      >
        {showsMessages ? (
          messages
        ) : (
          // Dark on the day sky's blue, white on the night sky.
          <Empty className="flex-none p-0 text-gray-950 dark:text-white dark:[text-shadow:0_1px_12px_rgb(15_23_80/0.35)]">
            <EmptyHeader className="max-w-xl">
              {temporary && (
                <EmptyMedia>
                  <GhostIcon className="size-10" />
                </EmptyMedia>
              )}
              <EmptyTitle
                className={cn(
                  "text-3xl font-medium tracking-tight transition-opacity duration-500 sm:text-4xl",
                  !titleReady && "opacity-0",
                )}
              >
                {title}
              </EmptyTitle>
              <EmptyDescription className="text-base font-medium text-gray-900 dark:text-white/90">
                {temporary
                  ? "It won't appear in your history, and it's deleted when you leave."
                  : "a8 is online and ready. What are we building today?"}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        <div className={showsMessages ? "shrink-0 px-4 pb-4" : "contents"}>
          {children}
        </div>
      </div>
    </div>
  );
}
