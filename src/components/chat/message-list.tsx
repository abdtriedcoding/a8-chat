"use client";

import type { PaginationStatus } from "convex/react";
import { CircleAlertIcon } from "lucide-react";
import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
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
import { stoppedTurns, type ThreadMessage } from "@/lib/stopped-turns";
import {
  AssistantMessage,
  StoppedMarker,
  ThinkingMessage,
} from "./assistant-message";
import { RegenerateButton } from "./regenerate-button";
import { UserMessage } from "./user-message";

/**
 * A thread's messages, oldest first. It follows a streaming reply until the
 * user scrolls up, and keeps its place when earlier messages load.
 */
export function MessageList({
  messages,
  status,
  onLoadEarlier,
  replyStatus,
  onRegenerate,
  onEdit,
  editingLastPrompt,
  onEditingLastPromptChange,
}: {
  messages: ThreadMessage[];
  status: PaginationStatus;
  onLoadEarlier: () => void;
  replyStatus: ReplyStatus;
  /** Set while the last turn can be regenerated. Only that turn shows it. */
  onRegenerate?: () => Promise<void>;
  /** Set while the last prompt can be edited. Only that prompt shows it. */
  onEdit?: (prompt: string) => Promise<void>;
  /** Whether the last prompt's editor is open. */
  editingLastPrompt: boolean;
  onEditingLastPromptChange: (editing: boolean) => void;
}) {
  const stopped = stoppedTurns(messages);
  const lastPromptIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  // The id of each turn's prompt, by order.
  const promptIds = new Map<number, string>();
  for (const message of messages) {
    if (message.role === "user") promptIds.set(message.order, message.id);
  }
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent
            aria-busy={replyStatus === "streaming"}
            className="mx-auto w-full max-w-3xl px-4 py-6"
          >
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

            {messages.map((message, i) => {
              const regenerate =
                i === messages.length - 1 ? onRegenerate : undefined;
              if (message.role === "user") {
                return (
                  <Fragment key={message.key}>
                    <MessageScrollerItem messageId={message.key} scrollAnchor>
                      <UserMessage
                        text={message.text}
                        attachments={message.parts.filter(
                          (part) => part.type === "file",
                        )}
                        onEdit={i === lastPromptIndex ? onEdit : undefined}
                        editing={i === lastPromptIndex && editingLastPrompt}
                        onEditingChange={onEditingLastPromptChange}
                      />
                    </MessageScrollerItem>
                    {/* Stopped before any reply was saved, so mark the prompt instead. */}
                    {stopped.has(message.order) &&
                      messages[i + 1]?.order !== message.order && (
                        <MessageScrollerItem
                          messageId={`${message.key}-stopped`}
                        >
                          <StoppedMarker onRegenerate={regenerate} />
                        </MessageScrollerItem>
                      )}
                  </Fragment>
                );
              }
              if (message.role === "assistant") {
                // A regenerated reply has the same key as the reply it
                // replaces, and useSmoothText would go on showing the old
                // text. Regenerate saves the prompt again with a new id, so
                // keying the reply on its prompt's id mounts a fresh one.
                const replyKey = promptIds.get(message.order) ?? message.key;
                return (
                  <MessageScrollerItem key={message.key} messageId={message.key}>
                    <AssistantMessage
                      key={replyKey}
                      message={message}
                      stopped={stopped.get(message.order)}
                      onRegenerate={regenerate}
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
                <Marker>
                  <MarkerIcon>
                    <CircleAlertIcon />
                  </MarkerIcon>
                  <MarkerContent>No reply received. Try again.</MarkerContent>
                  {onRegenerate && (
                    <RegenerateButton onRegenerate={onRegenerate} labelled />
                  )}
                </Marker>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
