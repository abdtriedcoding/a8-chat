"use client";

import { useSmoothText } from "@convex-dev/agent/react";
import { CircleStopIcon } from "lucide-react";
import { memo } from "react";
import { LogoMark } from "@/components/icons/logo-mark";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
} from "@/components/ui/message";
import type { ReplyParts } from "@/hooks/use-thread-state";
import type { ThreadMessage } from "@/lib/stopped-turns";
import { ActionCard } from "./action-card";
import {
  ConnectorToolRow,
  failedNeedingReconnect,
  isRunning,
} from "./connector-tool-call";
import { CopyReplyButton } from "./copy-reply-button";
import { Markdown } from "./markdown";
import { ReconnectChip } from "./reconnect-chip";
import { RegenerateButton } from "./regenerate-button";
import {
  isSearching,
  searchSources,
  SearchingMarker,
  SourcesRow,
  webSearchParts,
} from "./web-search";

export const AssistantMessage = memo(function AssistantMessage({
  message,
  reply: { text, toolCalls, waitingActions, toolRows },
  stopped,
  continuing = false,
  onRegenerate,
}: {
  message: ThreadMessage;
  reply: ReplyParts;
  /** Whether the user stopped this reply. */
  stopped?: boolean;
  /**
   * Whether the user has decided on the reply's action cards, and the reply
   * hasn't picked up again yet.
   */
  continuing?: boolean;
  /** Set on the last reply while it can be regenerated. */
  onRegenerate?: () => Promise<void>;
}) {
  const [visibleText, { isStreaming }] = useSmoothText(text, {
    startStreaming: message.status === "streaming",
  });

  // A stopped reply isn't streaming, even while its status still says
  // pending (the server finishes it a moment later). The smoothed text can
  // still be catching up, though.
  const streaming =
    (!stopped &&
      (message.status === "pending" ||
        message.status === "streaming" ||
        continuing)) ||
    isStreaming;

  // A stopped reply with no text shows only "Stopped".
  if (stopped && !text) {
    return <StoppedMarker onRegenerate={onRegenerate} />;
  }

  const searches = webSearchParts(message);
  // A stopped reply's search can stay unfinished, so only a streaming reply
  // shows one as running.
  const runningSearch = streaming ? searches.find(isSearching) : undefined;
  const sources = searchSources(searches);
  const reconnects = [
    ...new Set(
      toolCalls.filter(failedNeedingReconnect).map((call) => call.connector),
    ),
  ];
  // Between a tool call's result and the next text, the reply is thinking.
  const thinking =
    !visibleText &&
    streaming &&
    !runningSearch &&
    !toolCalls.some(isRunning);
  if (thinking && toolCalls.length === 0) return <ThinkingMessage />;

  const failed = message.status === "failed" && !stopped;
  // A failed reply has Regenerate in its error bubble, so the row under it
  // leaves Regenerate out.
  const footerRegenerate = failed ? undefined : onRegenerate;

  return (
    <Message align="start">
      <MessageAvatar className="size-8 self-start group-has-data-[slot=message-footer]/message:translate-y-0">
        <LogoMark className="size-4 text-primary" />
      </MessageAvatar>
      <MessageContent className="pt-1">
        {toolRows.length > 0 && (
          <div className="flex flex-col gap-2">
            {toolRows.map((call) => (
              <ConnectorToolRow
                key={call.id}
                call={call}
                running={streaming && isRunning(call)}
              />
            ))}
          </div>
        )}
        {thinking && (
          <span className="shimmer text-sm text-muted-foreground">
            Thinking…
          </span>
        )}
        {visibleText && (
          <Bubble variant="ghost" className="w-full">
            <BubbleContent className="w-full">
              <Markdown streaming={streaming}>{visibleText}</Markdown>
            </BubbleContent>
          </Bubble>
        )}
        {waitingActions.map((call) => (
          <ActionCard key={call.id} call={call} />
        ))}
        {reconnects.map((connector) => (
          <ReconnectChip key={connector.id} connector={connector} />
        ))}
        {runningSearch && (
          <SearchingMarker query={runningSearch.input?.query} />
        )}
        {sources.length > 0 && <SourcesRow sources={sources} />}
        {failed && (
          <Bubble variant="destructive">
            <BubbleContent className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span>
                Couldn&apos;t get a reply.
                {message.metadata?.failureReason &&
                  ` ${message.metadata.failureReason}`}
              </span>
              {onRegenerate && (
                <RegenerateButton onRegenerate={onRegenerate} labelled />
              )}
            </BubbleContent>
          </Bubble>
        )}
        {stopped && <StoppedMarker />}
        {!streaming && (text || footerRegenerate) && (
          <MessageFooter className="-mt-1.5 gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
            {text && <CopyReplyButton text={text} />}
            {footerRegenerate && (
              <RegenerateButton onRegenerate={footerRegenerate} />
            )}
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
});

export function ThinkingMessage() {
  return (
    <Message align="start">
      <MessageAvatar className="size-8 self-start">
        <LogoMark className="size-4 text-primary" />
      </MessageAvatar>
      <MessageContent className="pt-1">
        <Bubble variant="ghost">
          <BubbleContent>
            <span className="shimmer text-muted-foreground">Thinking…</span>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

/**
 * The "Stopped" label under a reply the user stopped. With `onRegenerate`,
 * a Regenerate button follows the label.
 */
export function StoppedMarker({
  onRegenerate,
}: {
  onRegenerate?: () => Promise<void>;
}) {
  return (
    <Marker>
      <MarkerIcon>
        <CircleStopIcon />
      </MarkerIcon>
      <MarkerContent>Stopped</MarkerContent>
      {onRegenerate && (
        <RegenerateButton onRegenerate={onRegenerate} labelled />
      )}
    </Marker>
  );
}
