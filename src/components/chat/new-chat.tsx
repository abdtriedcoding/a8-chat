"use client";

import { useMutation } from "convex/react";
import { GhostIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useOpenTemporaryThread } from "@/components/temporary-thread";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { UploadedAttachment } from "@/hooks/use-composer-attachments";
import { throwIfRefused } from "@/lib/errors";
import { api } from "../../../convex/_generated/api";
import { browserTimeZone } from "../../../convex/lib/timeZone";
import { ChatHeader } from "./chat-header";
import { Composer } from "./composer";
import { SkyBackdrop } from "./sky-backdrop";

/**
 * Puts the caret after a prompt the box starts with, so typing adds to it.
 * Defined once, so React calls it on mount only, not on every render.
 */
function caretToEnd(textarea: HTMLTextAreaElement | null) {
  textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
}

export function NewChat({ prompt }: { prompt?: string }) {
  const router = useRouter();
  const startThread = useMutation(api.chat.send.startThread);
  const [starting, setStarting] = useState(false);
  const [navigating, startNavigation] = useTransition();
  // Off on every visit, so a chat is never temporary by accident.
  const [temporary, setTemporary] = useState(false);
  const openTemporaryThread = useOpenTemporaryThread();
  const busy = starting || navigating;

  async function send(prompt: string, attachments: UploadedAttachment[]) {
    setStarting(true);
    try {
      const { threadId } = throwIfRefused(
        await startThread({
          prompt,
          attachmentFileIds: attachments.map(({ fileId }) => fileId),
          timeZone: browserTimeZone(),
          temporary,
        }),
      );
      if (temporary) openTemporaryThread(threadId);
      startNavigation(() => router.push(`/c/${threadId}`));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="relative isolate flex min-h-0 flex-1 flex-col">
      <SkyBackdrop className="absolute inset-0 -z-10" />
      <ChatHeader
        className="border-transparent"
        end={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={temporary ? "secondary" : "ghost"}
                size="icon-sm"
                aria-label="Temporary chat"
                aria-pressed={temporary}
                disabled={busy}
                onClick={() => setTemporary(!temporary)}
              >
                <GhostIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {temporary ? "Turn off temporary chat" : "Temporary chat"}
            </TooltipContent>
          </Tooltip>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 overflow-y-auto px-4 pb-16">
        {/* Dark on the day sky's blue, white on the night sky. */}
        <Empty className="flex-none p-0 text-gray-950 dark:text-white dark:[text-shadow:0_1px_12px_rgb(15_23_80/0.35)]">
          <EmptyHeader className="max-w-xl">
            {temporary && (
              <EmptyMedia>
                <GhostIcon className="size-10" />
              </EmptyMedia>
            )}
            <EmptyTitle className="text-3xl font-medium tracking-tight sm:text-4xl">
              {temporary ? "Temporary chat" : "What can I help with?"}
            </EmptyTitle>
            <EmptyDescription className="text-base font-medium text-gray-900 dark:text-white/90">
              {temporary
                ? "It won't appear in your history, and it's deleted when you leave."
                : "Ask a question, or paste something you want to work on."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
        <Composer
          key={prompt}
          initialText={prompt}
          textareaRef={caretToEnd}
          onSend={send}
          disabled={busy}
          autoFocus
          className="w-full max-w-2xl *:data-[slot=input-group]:rounded-xl *:data-[slot=input-group]:border-white/60 *:data-[slot=input-group]:shadow-[0_12px_40px_-12px_rgb(30_58_138/0.45)] dark:*:data-[slot=input-group]:border-white/15 dark:*:data-[slot=input-group]:bg-card/75 dark:*:data-[slot=input-group]:shadow-[0_12px_40px_-12px_rgb(0_0_0/0.6)] dark:*:data-[slot=input-group]:backdrop-blur-xl"
        />
      </div>
    </div>
  );
}
