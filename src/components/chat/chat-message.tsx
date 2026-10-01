"use client";

import { useSmoothText, type UIMessage } from "@convex-dev/agent/react";
import { CircleAlertIcon, CircleStopIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { LogoMark } from "@/components/logo";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  Message,
  MessageAvatar,
  MessageContent,
} from "@/components/ui/message";
import { Markdown } from "./markdown";
import { RegenerateButton, ReplyActions } from "./reply-actions";

/**
 * How the user stopped a turn's reply, and whether the reply runner is done
 * with the turn (convex/lib/stop.ts).
 */
export type Stop = { keepText: boolean; settled: boolean };

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
  onRegenerate,
}: {
  message: ThreadMessage;
  /** Set when the user stopped this message's turn. */
  stopped?: Stop;
  /** Set on the last reply once it's done. A rejection shows as a toast. */
  onRegenerate?: () => Promise<void>;
}) {
  if (message.role === "user") return <UserMessage text={message.text} />;
  if (message.role === "assistant") {
    return (
      <AssistantMessage
        message={message}
        stopped={stopped}
        onRegenerate={onRegenerate}
      />
    );
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
  onRegenerate,
}: {
  message: ThreadMessage;
  stopped?: Stop;
  onRegenerate?: () => Promise<void>;
}) {
  // A reply stopped before the user saw any of it shows none of it later.
  const source = stopped?.keepText === false ? "" : message.text;
  // A regenerated reply takes the old one's place, and its key. Its text
  // starts over, which the smoothed text can't do, so the reply remounts.
  const [restarts, setRestarts] = useState({ source, count: 0 });
  if (source !== restarts.source) {
    const restarted = !source.startsWith(restarts.source);
    setRestarts({ source, count: restarts.count + (restarted ? 1 : 0) });
  }
  return (
    <AssistantReply
      key={restarts.count}
      message={message}
      source={source}
      stopped={stopped}
      onRegenerate={onRegenerate}
    />
  );
}

/** The reply itself, remounted by AssistantMessage when its text starts over. */
function AssistantReply({
  message,
  source,
  stopped,
  onRegenerate,
}: {
  message: ThreadMessage;
  /** The text to show. */
  source: string;
  stopped?: Stop;
  onRegenerate?: () => Promise<void>;
}) {
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
  // A stopped reply is failed until its text is saved, or for good if it went.
  const failed = message.status === "failed" && !stopped;
  // A failed reply's Regenerate is in its bubble instead.
  const actionsRegenerate = failed ? undefined : onRegenerate;

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
      {failed && (
        <Bubble variant="destructive">
          <BubbleContent className="flex flex-wrap items-center gap-x-3 gap-y-2">
            Couldn&apos;t get a reply.
            {onRegenerate && (
              <RegenerateButton onRegenerate={onRegenerate} labelled />
            )}
          </BubbleContent>
        </Bubble>
      )}
      {stopped && <StoppedMarker />}
      {/* The full source, not the smoothed text, which can lag behind. */}
      {!streaming && (source || actionsRegenerate) && (
        <ReplyActions text={source} onRegenerate={actionsRegenerate} />
      )}
    </AssistantRow>
  );
}

/** Where a reply would be, for a turn stopped before its reply began. */
export function StoppedReply({
  onRegenerate,
}: {
  /** Set on the last turn. A rejection shows as a toast. */
  onRegenerate?: () => Promise<void>;
}) {
  return (
    <AssistantRow>
      <StoppedMarker />
      {onRegenerate && <ReplyActions onRegenerate={onRegenerate} />}
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
