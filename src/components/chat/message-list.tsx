"use client";

import type { PaginationStatus } from "convex/react";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Spinner } from "@/components/ui/spinner";
import type { ReplyStatus } from "@/hooks/use-reply-status";
import type { ThreadMessage } from "@/lib/stopped-turns";
import { ActionCardAnnouncer, KnownItemsContext } from "./action-card";
import { knownItems } from "./action-summary";
import { AssistantMessage, ThinkingMessage } from "./assistant-message";
import { connectorToolCalls, replyWaitingActions } from "./connector-tool-call";
import { TurnMarker } from "./turn-marker";
import { UserMessage } from "./user-message";

export function MessageList({
  messages,
  status,
  onLoadEarlier,
  stopped,
  replyStatus,
  stale = false,
}: {
  messages: ThreadMessage[];
  status: PaginationStatus;
  /** Unset while earlier messages can't load yet, which turns the button off. */
  onLoadEarlier?: () => void;
  /**
   * The orders of the turns the user stopped. A streaming reply carries no
   * metadata, so this keeps "Stopped" showing while the stream aborts.
   */
  stopped: Set<number>;
  replyStatus: ReplyStatus;
  /** Set while the messages are the device's copy, not live data. */
  stale?: boolean;
}) {
  const lastPromptIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  // Each turn's prompt id, by order. Regenerate saves the prompt again with
  // a new id, so this tells a regenerated reply from the one it replaces.
  const promptIds = new Map<number, string>();
  for (const message of messages) {
    if (message.role === "user") promptIds.set(message.order, message.id);
  }
  const toolCalls = messages.flatMap((message) =>
    message.role === "assistant" ? connectorToolCalls(message) : [],
  );
  const known = knownItems(
    toolCalls.flatMap((call) =>
      call.state === "output-available" ? [call.output] : [],
    ),
  );
  const waitingActions = messages.flatMap((message) =>
    message.role === "assistant"
      ? replyWaitingActions(
          connectorToolCalls(message),
          stopped.has(message.order),
        )
      : [],
  );
  return (
    <KnownItemsContext value={known}>
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            {(status === "CanLoadMore" || status === "LoadingMore") && (
              <div className="mx-auto flex w-full max-w-3xl justify-center px-4 pt-6 pb-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={status === "LoadingMore" || !onLoadEarlier}
                  onClick={onLoadEarlier}
                >
                  {status === "LoadingMore" && (
                    <Spinner data-icon="inline-start" />
                  )}
                  Load earlier messages
                </Button>
              </div>
            )}
            <MessageScrollerContent
              aria-busy={replyStatus === "streaming"}
              className="mx-auto w-full max-w-3xl px-4 py-6"
            >
              {messages.map((message, i) => {
                const lastTurn = i === messages.length - 1;
                if (message.role === "user") {
                  return (
                    <Fragment key={message.key}>
                      <MessageScrollerItem messageId={message.key} scrollAnchor>
                        <UserMessage
                          text={message.text}
                          parts={message.parts}
                          lastPrompt={i === lastPromptIndex}
                        />
                      </MessageScrollerItem>
                      {/* Stopped before any reply was saved, so mark the prompt instead. */}
                      {stopped.has(message.order) &&
                        messages[i + 1]?.order !== message.order && (
                          <MessageScrollerItem
                            messageId={`${message.key}-stopped`}
                          >
                            <TurnMarker kind="stopped" regenerate={lastTurn} />
                          </MessageScrollerItem>
                        )}
                    </Fragment>
                  );
                }
                if (message.role === "assistant") {
                  // A regenerated reply has the same key as the reply it
                  // replaces, and useSmoothText would go on showing the old
                  // text. Keying the reply on its prompt's id mounts a fresh
                  // one. The item keeps its key: when "load earlier" brings in
                  // the prompt, the scroller still has the element it anchors
                  // to.
                  const replyKey = promptIds.get(message.order) ?? message.key;
                  return (
                    <MessageScrollerItem
                      key={message.key}
                      messageId={message.key}
                    >
                      <AssistantMessage
                        key={replyKey}
                        message={message}
                        stopped={stopped.has(message.order)}
                        continuing={lastTurn && replyStatus === "continuing"}
                        lastTurn={lastTurn}
                      />
                    </MessageScrollerItem>
                  );
                }
                return null;
              })}

              {replyStatus === "waiting" && (
                <MessageScrollerItem messageId="pending-reply">
                  <ThinkingMessage />
                </MessageScrollerItem>
              )}
              {replyStatus === "timedOut" && (
                <MessageScrollerItem messageId="reply-timed-out">
                  <TurnMarker kind="timedOut" regenerate />
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
          <ActionCardAnnouncer calls={waitingActions} />
          <ReplyAnnouncer
            replyStatus={replyStatus}
            stale={stale}
            last={messages.at(-1)}
            stopped={stopped}
            waitingForApproval={waitingActions.length > 0}
          />
        </MessageScroller>
      </MessageScrollerProvider>
    </KnownItemsContext>
  );
}

/**
 * Tells screen readers when the latest reply ends, and how. The message list
 * stays quiet while a reply streams in, since reading every chunk would be
 * too noisy.
 */
function ReplyAnnouncer({
  replyStatus,
  stale,
  last,
  stopped,
  waitingForApproval,
}: {
  replyStatus: ReplyStatus;
  /**
   * The device's copy can be saved mid-reply. Counting that would announce
   * a reply that ended while the user was away.
   */
  stale: boolean;
  last: ThreadMessage | undefined;
  stopped: Set<number>;
  /** ActionCardAnnouncer reads the actions waiting for approval instead. */
  waitingForApproval: boolean;
}) {
  const inProgress =
    !stale &&
    (replyStatus === "waiting" ||
      replyStatus === "continuing" ||
      replyStatus === "streaming");
  const [wasInProgress, setWasInProgress] = useState(inProgress);
  const [announcement, setAnnouncement] = useState("");
  if (inProgress !== wasInProgress) {
    setWasInProgress(inProgress);
    // Cleared when the next reply starts, so the same words are read again.
    setAnnouncement(
      inProgress ? "" : replyEnd(replyStatus, last, stopped, waitingForApproval),
    );
  }
  return (
    <div role="status" className="sr-only">
      {announcement}
    </div>
  );
}

function replyEnd(
  replyStatus: ReplyStatus,
  last: ThreadMessage | undefined,
  stopped: Set<number>,
  waitingForApproval: boolean,
) {
  if (replyStatus === "timedOut") return "No reply received. Try again.";
  if (last && stopped.has(last.order)) return "Reply stopped.";
  if (last?.role === "assistant" && last.status === "failed") {
    const reason = last.metadata?.failureReason;
    return `Couldn't get a reply.${reason ? ` ${reason}` : ""}`;
  }
  return waitingForApproval ? "" : "Reply finished.";
}
