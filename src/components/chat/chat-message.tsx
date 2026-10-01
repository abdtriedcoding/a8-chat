"use client";

import { useSmoothText, type UIMessage } from "@convex-dev/agent/react";
import { CircleAlertIcon, CircleStopIcon } from "lucide-react";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/logo";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  Message,
  MessageAvatar,
  MessageContent,
} from "@/components/ui/message";
import { Markdown } from "./markdown";
import { ReplyActions } from "./reply-actions";

/** How the user stopped a turn's reply (convex/lib/stop.ts). */
export type Stop = { keepText: boolean };

/**
 * A message as the thread lists it. `stopped` is on every message of a turn
 * whose reply the user stopped. Messages the client makes itself, such as
 * an optimistic prompt or a reply rebuilt from its stream, don't have it.
 */
export type ThreadMessage = UIMessage & { stopped?: Stop | null };

/** The turns whose replies were stopped, by order (a prompt and its reply share one). */
export function stoppedTurns(messages: ThreadMessage[]): Map<number, Stop> {
  const turns = new Map<number, Stop>();
  for (const { order, stopped } of messages) {
    if (stopped) turns.set(order, stopped);
  }
  return turns;
}

export function ChatMessage({
  message,
  stopped,
}: {
  message: ThreadMessage;
  /** Set when the user stopped this message's turn. */
  stopped?: Stop;
}) {
  if (message.role === "user") return <UserMessage text={message.text} />;
  if (message.role === "assistant") {
    return <AssistantMessage message={message} stopped={stopped} />;
  }
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

function AssistantMessage({
  message,
  stopped,
}: {
  message: ThreadMessage;
  stopped?: Stop;
}) {
  // A reply stopped before the user saw any of it shows none of it later.
  const source = stopped?.keepText === false ? "" : message.text;
  // Only a reply that mounts mid-stream types itself out; one loaded from
  // history shows in full at once.
  const [smoothed, { isStreaming: typing }] = useSmoothText(source, {
    startStreaming: message.status === "streaming",
  });
  // The smoothed text never shrinks, so text that goes is cut here.
  const text = source ? smoothed : "";
  const inProgress =
    !stopped && (message.status === "pending" || message.status === "streaming");
  // The smoothed text can still be catching up after the reply is done.
  const streaming = inProgress || typing;

  return (
    <AssistantRow>
      {text ? (
        <Bubble variant="ghost" className="w-full">
          <BubbleContent className="w-full">
            <Markdown streaming={streaming}>{text}</Markdown>
          </BubbleContent>
        </Bubble>
      ) : (
        inProgress && <Thinking />
      )}
      {/* A stopped reply is failed until its text is saved, or for good if it went. */}
      {message.status === "failed" && !stopped && (
        <Bubble variant="destructive">
          <BubbleContent>
            Couldn&apos;t get a reply. Send your message again to retry.
          </BubbleContent>
        </Bubble>
      )}
      {stopped && <StoppedMarker />}
      {/* The full source, not the smoothed text, which can lag behind. */}
      {!streaming && source && <ReplyActions text={source} />}
    </AssistantRow>
  );
}

/** Where a reply would be, for a turn stopped before its reply began. */
export function StoppedReply() {
  return (
    <AssistantRow>
      <StoppedMarker />
    </AssistantRow>
  );
}

function StoppedMarker() {
  return (
    <Marker>
      <MarkerIcon>
        <CircleStopIcon />
      </MarkerIcon>
      <MarkerContent>Stopped</MarkerContent>
    </Marker>
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
      {/* Pinned to the top, so a reply's actions row mustn't lift it. */}
      <MessageAvatar className="size-8 self-start group-has-data-[slot=message-footer]/message:translate-y-0">
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
