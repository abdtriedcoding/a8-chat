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
import {
  ChatMessage,
  PendingReply,
  StoppedReply,
  stoppedTurns,
  type ThreadMessage,
} from "./chat-message";

/**
 * A thread's messages, oldest first. It follows a streaming reply until the
 * user scrolls up, and keeps its place when earlier messages load.
 */
export function MessageList({
  messages,
  status,
  onLoadEarlier,
  pendingReply,
  onRegenerate,
}: {
  messages: ThreadMessage[];
  status: PaginationStatus;
  onLoadEarlier: () => void;
  /** Set while the latest prompt has no reply yet. */
  pendingReply: { stale: boolean } | null;
  /** Set while the last reply can be regenerated, which only it can. */
  onRegenerate?: () => Promise<void>;
}) {
  const stopped = stoppedTurns(messages);
  const lastIndex = messages.length - 1;
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="flex-1">
        <MessageScrollerViewport aria-label="Messages">
          <MessageScrollerContent className="mx-auto w-full max-w-3xl px-4 py-6">
            {(status === "CanLoadMore" || status === "LoadingMore") && (
              <MessageScrollerItem className="flex justify-center">
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
              </MessageScrollerItem>
            )}
            {messages.map((message, i) => (
              <Fragment key={message.key}>
                <MessageScrollerItem
                  messageId={message.key}
                  scrollAnchor={message.role === "user"}
                >
                  <ChatMessage
                    message={message}
                    stopped={stopped.get(message.order)}
                    onRegenerate={i === lastIndex ? onRegenerate : undefined}
                  />
                </MessageScrollerItem>
                {/* A turn stopped before its reply began has no reply to mark. */}
                {message.role === "user" &&
                  stopped.has(message.order) &&
                  messages[i + 1]?.order !== message.order && (
                    <MessageScrollerItem messageId={`${message.key}-stopped`}>
                      <StoppedReply
                        onRegenerate={i === lastIndex ? onRegenerate : undefined}
                      />
                    </MessageScrollerItem>
                  )}
              </Fragment>
            ))}
            {pendingReply && (
              <MessageScrollerItem messageId="pending-reply">
                <PendingReply stale={pendingReply.stale} />
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
