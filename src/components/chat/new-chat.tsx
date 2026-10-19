"use client";

import { useMutation } from "convex/react";
import { GhostIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LogoMark } from "@/components/icons/logo-mark";
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
    <>
      <ChatHeader
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
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-4 pb-16">
        <Empty className="flex-none p-0">
          <EmptyHeader>
            <EmptyMedia>
              {temporary ? (
                <GhostIcon className="size-10 text-primary" />
              ) : (
                <LogoMark className="size-10 text-primary" />
              )}
            </EmptyMedia>
            {temporary ? (
              <>
                <EmptyTitle>Temporary chat</EmptyTitle>
                <EmptyDescription>
                  It won&apos;t appear in your history, and it&apos;s deleted
                  when you leave.
                </EmptyDescription>
              </>
            ) : (
              <>
                <EmptyTitle>What can I help with?</EmptyTitle>
                <EmptyDescription>
                  Ask a question, or paste something you want to work on.
                </EmptyDescription>
              </>
            )}
          </EmptyHeader>
        </Empty>
        <Composer
          key={prompt}
          initialText={prompt}
          textareaRef={caretToEnd}
          onSend={send}
          disabled={busy}
          autoFocus
          className="w-full max-w-2xl"
        />
      </div>
    </>
  );
}
