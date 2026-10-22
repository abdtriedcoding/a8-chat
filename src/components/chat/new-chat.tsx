"use client";

import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { GhostIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useOpenTemporaryThread } from "@/components/temporary-thread";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { UploadedAttachment } from "@/hooks/use-composer-attachments";
import { useInBrowser } from "@/hooks/use-in-browser";
import { throwIfRefused } from "@/lib/errors";
import { api } from "../../../convex/_generated/api";
import { browserTimeZone } from "../../../convex/lib/timeZone";
import { Composer } from "./composer";
import { NEW_CHAT_COMPOSER_CLASS, NewChatFrame } from "./new-chat-frame";

/**
 * Puts the caret after a prompt the box starts with, so typing adds to it.
 * Defined once, so React calls it on mount only, not on every render.
 */
function caretToEnd(textarea: HTMLTextAreaElement | null) {
  textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
}

/** The greeting for the browser's local hour, like "Good evening". */
function greetingFor(hour: number) {
  if (hour < 5) return "Burning the midnight oil";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function NewChat({ prompt }: { prompt?: string }) {
  const router = useRouter();
  const startThread = useMutation(api.chat.send.startThread);
  const [starting, setStarting] = useState(false);
  const [navigating, startNavigation] = useTransition();
  // Off on every visit, so a chat is never temporary by accident.
  const [temporary, setTemporary] = useState(false);
  // Off on every visit too, so a chat never skips cards by accident.
  const [autoApprove, setAutoApprove] = useState(false);
  const openTemporaryThread = useOpenTemporaryThread();
  const busy = starting || navigating;
  // The chat starts on the user's default model, unless they pick another.
  const defaultModelId = useQuery(api.models.defaultModel, {});
  const [pickedModelId, setPickedModelId] = useState<string>();
  const modelId = pickedModelId ?? defaultModelId ?? undefined;
  const user = useQuery(api.auth.getCurrentUser, {});
  const firstName = user?.name.trim().split(/\s+/)[0];
  // The server doesn't know the local hour, and the name loads after the
  // page, so the greeting stays hidden until both are in.
  const inBrowser = useInBrowser();
  const greetingReady = inBrowser && user !== undefined;
  const greeting = inBrowser ? greetingFor(new Date().getHours()) : "Hello";

  async function send(prompt: string, attachments: UploadedAttachment[]) {
    setStarting(true);
    try {
      const { threadId } = throwIfRefused(
        await startThread({
          prompt,
          attachmentFileIds: attachments.map(({ fileId }) => fileId),
          timeZone: browserTimeZone(),
          temporary,
          autoApprove,
          modelId,
        }),
      );
      if (temporary) openTemporaryThread(threadId);
      startNavigation(() => router.push(`/c/${threadId}`));
    } finally {
      setStarting(false);
    }
  }

  return (
    <NewChatFrame
      temporary={temporary}
      title={
        temporary
          ? "Temporary chat"
          : firstName
            ? `${greeting}, ${firstName}.`
            : `${greeting}.`
      }
      titleReady={temporary || greetingReady}
      headerEnd={
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
    >
      <Composer
        key={prompt}
        initialText={prompt}
        textareaRef={caretToEnd}
        onSend={send}
        disabled={busy}
        autoApprove={autoApprove}
        onAutoApproveChange={setAutoApprove}
        modelId={modelId}
        onModelChange={setPickedModelId}
        autoFocus
        className={NEW_CHAT_COMPOSER_CLASS}
      />
    </NewChatFrame>
  );
}
