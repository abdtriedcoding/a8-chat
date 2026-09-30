"use client";

import { useSmoothText, type UIMessage } from "@convex-dev/agent/react";
import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/logo";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  Message,
  MessageAvatar,
  MessageContent,
} from "@/components/ui/message";

export function ChatMessage({ message }: { message: UIMessage }) {
  if (message.role === "user") return <UserMessage text={message.text} />;
  if (message.role === "assistant") return <AssistantMessage message={message} />;
  return null;
}

function UserMessage({ text }: { text: string }) {
  return (
    <Message align="end">
      <MessageContent>
        <Bubble variant="tinted" align="end">
          <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

function AssistantMessage({ message }: { message: UIMessage }) {
  // Only a reply that mounts mid-stream types itself out; one loaded from
  // history shows in full at once.
  const [text] = useSmoothText(message.text, {
    startStreaming: message.status === "streaming",
  });
  const inProgress =
    message.status === "pending" || message.status === "streaming";

  return (
    <AssistantRow>
      {text ? (
        <Bubble variant="ghost">
          <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
        </Bubble>
      ) : (
        inProgress && <Thinking />
      )}
      {message.status === "failed" && (
        <Bubble variant="destructive">
          <BubbleContent>
            Couldn&apos;t get a reply. Send your message again to retry.
          </BubbleContent>
        </Bubble>
      )}
    </AssistantRow>
  );
}

/**
 * Shown after the user's message until the reply starts. `stale` means
 * nothing has come back for a while, so it's probably not coming.
 */
export function PendingReply({ stale }: { stale: boolean }) {
  if (stale) {
    return (
      <Marker>
        <MarkerIcon>
          <CircleAlertIcon />
        </MarkerIcon>
        <MarkerContent>No reply received. Try again.</MarkerContent>
      </Marker>
    );
  }
  return (
    <AssistantRow>
      <Thinking />
    </AssistantRow>
  );
}

function AssistantRow({ children }: { children: ReactNode }) {
  return (
    <Message align="start">
      <MessageAvatar className="size-8 self-start">
        <LogoMark className="size-4 text-primary" />
      </MessageAvatar>
      <MessageContent className="pt-1">{children}</MessageContent>
    </Message>
  );
}

function Thinking() {
  return (
    <Bubble variant="ghost">
      <BubbleContent>
        <span className="shimmer text-muted-foreground">Thinking…</span>
      </BubbleContent>
    </Bubble>
  );
}
