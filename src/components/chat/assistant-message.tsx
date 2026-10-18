"use client";

import { useSmoothText } from "@convex-dev/agent/react";
import { memo } from "react";
import { LogoMark } from "@/components/icons/logo-mark";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
} from "@/components/ui/message";
import { replyText } from "@/lib/reply-text";
import type { ThreadMessage } from "@/lib/stopped-turns";
import { ActionCard } from "./action-card";
import {
  ConnectorToolRow,
  connectorToolCalls,
  failedNeedingReconnect,
  isRunning,
  replyWaitingActions,
} from "./connector-tool-call";
import { CopyReplyButton } from "./copy-reply-button";
import { Markdown } from "./markdown";
import { ReconnectChip } from "./reconnect-chip";
import { RegenerateButton } from "./regenerate-button";
import { useThreadActionsContext } from "./thread-actions-context";
import { TurnMarker } from "./turn-marker";
import {
  isSearching,
  searchSources,
  SearchingMarker,
  SourcesRow,
  webSearchParts,
} from "./web-search";

export const AssistantMessage = memo(function AssistantMessage({
  message,
  stopped = false,
  continuing = false,
  lastTurn = false,
}: {
  message: ThreadMessage;
  /** Whether the user stopped this reply. */
  stopped?: boolean;
  /**
   * Whether the user has decided on the reply's action cards, and the reply
   * hasn't picked up again yet.
   */
  continuing?: boolean;
  /** Whether this is the last turn's reply, which can be regenerated. */
  lastTurn?: boolean;
}) {
  const { regenerate } = useThreadActionsContext();
  const text = replyText(message);
  const toolCalls = connectorToolCalls(message);
  const waitingActions = replyWaitingActions(toolCalls, stopped);
  // Every call without a card shows as a row.
  const toolRows = toolCalls.filter((call) => !waitingActions.includes(call));
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
    return <TurnMarker kind="stopped" regenerate={lastTurn} />;
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
  const footerRegenerate = lastTurn && !failed && regenerate !== undefined;

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
          <TurnMarker
            kind="failed"
            reason={message.metadata?.failureReason}
            regenerate={lastTurn}
          />
        )}
        {stopped && <TurnMarker kind="stopped" />}
        {!streaming && (text || footerRegenerate) && (
          <MessageFooter className="-mt-1.5 gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
            {text && <CopyReplyButton text={text} />}
            {footerRegenerate && <RegenerateButton />}
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
