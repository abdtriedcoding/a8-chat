"use client";

import type { PaginationStatus } from "convex/react";
import { Fragment } from "react";
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
import type { ThreadState } from "@/hooks/use-thread-state";
import type { ThreadMessage } from "@/lib/stopped-turns";
import { ActionCardAnnouncer } from "./action-card";
import { AssistantMessage, ThinkingMessage } from "./assistant-message";
import { TurnMarker } from "./turn-marker";
import { UserMessage } from "./user-message";

/**
 * A thread's messages, oldest first. It follows a streaming reply until the
 * user scrolls up, and keeps its place when earlier messages load.
 */
export function MessageList({
  messages,
  status,
  onLoadEarlier,
  threadState: { stopped, replyStatus, replies, promptIds, waitingActions },
}: {
  messages: ThreadMessage[];
  status: PaginationStatus;
  onLoadEarlier: () => void;
  threadState: ThreadState;
}) {
  const lastPromptIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="flex-1">
        <MessageScrollerViewport>
          {/* Outside the content on purpose. The scroller keeps its place
              when earlier messages load only if the content's first child
              moves down, and this button would always stay first. */}
          {(status === "CanLoadMore" || status === "LoadingMore") && (
            <div className="mx-auto flex w-full max-w-3xl justify-center px-4 pt-6 pb-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={status === "LoadingMore"}
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
                        attachments={message.parts.filter(
                          (part) => part.type === "file",
                        )}
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
              const reply = replies.get(message.id);
              if (reply) {
                // A regenerated reply has the same key as the reply it
                // replaces, and useSmoothText would go on showing the old
                // text. Keying the reply on its prompt's id mounts a fresh
                // one. The item keeps its key: when "load earlier" brings in
                // the prompt, the scroller still has the element it anchors
                // to.
                const replyKey = promptIds.get(message.order) ?? message.key;
                return (
                  <MessageScrollerItem key={message.key} messageId={message.key}>
                    <AssistantMessage
                      key={replyKey}
                      message={message}
                      reply={reply}
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
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
