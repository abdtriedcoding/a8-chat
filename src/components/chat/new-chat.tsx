"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LogoMark } from "@/components/icons/logo-mark";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { browserTimeZone } from "@/lib/time-zone";
import { api } from "../../../convex/_generated/api";
import { ChatHeader } from "./chat-header";
import { Composer } from "./composer";

/** The new-chat page: sending the first message creates the thread. */
export function NewChat() {
  const router = useRouter();
  const startThread = useMutation(api.chat.startThread);
  // Covers the navigation to the new thread, so the composer stays busy
  // until the thread page takes over.
  const [navigating, startNavigation] = useTransition();

  async function send(prompt: string) {
    const { threadId } = await startThread({
      prompt,
      timeZone: browserTimeZone(),
    });
    startNavigation(() => router.push(`/c/${threadId}`));
  }

  return (
    <>
      <ChatHeader />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-4 pb-16">
        <Empty className="flex-none p-0">
          <EmptyHeader>
            <EmptyMedia>
              <LogoMark className="size-10 text-primary" />
            </EmptyMedia>
            <EmptyTitle>What can I help with?</EmptyTitle>
            <EmptyDescription>
              Ask a question, or paste something you want to work on.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
        <Composer
          onSend={send}
          busy={navigating}
          autoFocus
          className="w-full max-w-2xl"
        />
      </div>
    </>
  );
}
