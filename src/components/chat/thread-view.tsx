"use client";

import { useUIMessages } from "@convex-dev/agent/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { MessageSquareOffIcon } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useThreadShortcuts } from "@/components/keyboard-shortcuts";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useReplyStatus } from "@/hooks/use-reply-status";
import { errorMessage, throwIfRefused } from "@/lib/errors";
import { optimisticallySendPrompt } from "@/lib/optimistic-prompt";
import { replyText } from "@/lib/reply-text";
import {
  stoppedTurns,
  type Stop,
  type ThreadMessage,
} from "@/lib/stopped-turns";
import { browserTimeZone } from "@/lib/time-zone";
import { api } from "../../../convex/_generated/api";
import { ChatHeader, ThreadHeading } from "./chat-header";
import { Composer } from "./composer";
import { MessageList } from "./message-list";

const PAGE_SIZE = 20;

export function ThreadView({ threadId }: { threadId: string }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const thread = useQuery(api.threads.get, isLoading ? "skip" : { threadId });

  const {
    results: messages,
    status,
    loadMore,
  } = useUIMessages(
    api.chat.listThreadMessages,
    isAuthenticated ? { threadId } : "skip",
    { initialNumItems: PAGE_SIZE, stream: true },
  );

  const sendMessage = useMutation(api.chat.sendMessage);

  const stopReply = useMutation(api.chat.stopReply);
  const regenerateReply = useMutation(api.chat.regenerateReply);
  const editPrompt = useMutation(api.chat.editPrompt);
  const decideAction = useMutation(api.chat.decideAction);

  const replyStatus = useReplyStatus(messages);
  const replyInProgress =
    replyStatus === "waiting" ||
    replyStatus === "continuing" ||
    replyStatus === "streaming";
  const last = messages.at(-1);
  // The last turn can be regenerated or edited while no reply is in
  // progress. A stopped turn counts as done, and so does a reply that timed
  // out.
  const canRedoLastTurn = last !== undefined && !replyInProgress;

  // Whether the last prompt's editor is open. It closes when the prompt
  // can't be edited anymore, for example when another tab sends a new prompt.
  const [editingLastPrompt, setEditingLastPrompt] = useState(false);
  if (!canRedoLastTurn && editingLastPrompt) setEditingLastPrompt(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Set when ↑ in the message box opened the editor, so closing it puts the
  // focus back there.
  const editOpenedByKey = useRef(false);

  function changeEditingLastPrompt(editing: boolean, byKey = false) {
    if (editing) {
      editOpenedByKey.current = byKey;
    } else if (editOpenedByKey.current) {
      editOpenedByKey.current = false;
      composerRef.current?.focus();
    }
    setEditingLastPrompt(editing);
  }

  async function stop() {
    // Keep the reply's text only if some is on screen. If the user stopped
    // during "Thinking…", the reply is hidden. A reply that continues after
    // an action card keeps what it had before, so the model still sees it.
    const keepText =
      replyStatus === "continuing" ||
      (last?.role === "assistant" && last.text !== "");
    await stopReply({ threadId, keepText });
  }

  const lastReply = messages.findLast(({ role }) => role === "assistant");
  const lastReplyText =
    lastReply &&
    copyableText(lastReply, stoppedTurns(messages).get(lastReply.order));

  useThreadShortcuts({
    stopReply: replyInProgress
      ? () => {
          stop().catch((error: unknown) => toast.error(errorMessage(error)));
        }
      : undefined,
    editLastPrompt: canRedoLastTurn
      ? () => changeEditingLastPrompt(true, true)
      : undefined,
    copyLastReply: lastReplyText
      ? () => void copyReply(lastReplyText)
      : undefined,
  });

  if (thread === null) {
    return (
      <>
        <ChatHeader />
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquareOffIcon />
            </EmptyMedia>
            <EmptyTitle>Chat not found</EmptyTitle>
            <EmptyDescription>
              It may have been deleted, or the link is wrong.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href="/chat">Start a new chat</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </>
    );
  }

  return (
    <>
      <ChatHeader>
        {thread && <ThreadHeading threadId={threadId} title={thread.title} />}
      </ChatHeader>
      {thread === undefined || status === "LoadingFirstPage" ? (
        <ConversationSkeleton />
      ) : (
        <MessageList
          messages={messages}
          status={status}
          onLoadEarlier={() => loadMore(PAGE_SIZE)}
          replyStatus={replyStatus}
          onRegenerate={
            canRedoLastTurn
              ? async () => {
                  throwIfRefused(
                    await regenerateReply({
                      threadId,
                      timeZone: browserTimeZone(),
                    }),
                  );
                }
              : undefined
          }
          onEdit={
            canRedoLastTurn
              ? async (prompt) => {
                  throwIfRefused(
                    await editPrompt({
                      threadId,
                      prompt,
                      timeZone: browserTimeZone(),
                    }),
                  );
                }
              : undefined
          }
          onDecideAction={async (approvalId, approve) => {
            await decideAction({
              threadId,
              approvalId,
              approve,
              timeZone: browserTimeZone(),
            });
          }}
          editingLastPrompt={editingLastPrompt}
          onEditingLastPromptChange={changeEditingLastPrompt}
        />
      )}
      <div className="shrink-0 px-4 pb-4">
        <Composer
          onSend={async (prompt, attachments) => {
            // Set up for each Send, since the optimistic prompt shows the
            // attachments' URLs, and the mutation only takes their IDs.
            const sendMessageWithOptimisticPrompt =
              sendMessage.withOptimisticUpdate((localStore) =>
                optimisticallySendPrompt(localStore, {
                  threadId,
                  prompt,
                  attachments,
                }),
              );
            throwIfRefused(
              await sendMessageWithOptimisticPrompt({
                threadId,
                prompt,
                attachmentFileIds: attachments.map(({ fileId }) => fileId),
                timeZone: browserTimeZone(),
              }),
            );
          }}
          onStop={replyInProgress ? stop : undefined}
          disabled={replyInProgress}
          autoFocus
          textareaRef={composerRef}
          className="mx-auto max-w-3xl"
        />
      </div>
    </>
  );
}

/**
 * The text Copy under a reply copies: none while the reply is still being
 * written, or when the user stopped it before any text showed.
 */
function copyableText(reply: ThreadMessage, stopped: Stop | undefined) {
  if (stopped) return stopped.keepText ? replyText(reply) : "";
  if (reply.status === "pending" || reply.status === "streaming") return "";
  return replyText(reply);
}

async function copyReply(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied the last reply.");
  } catch {
    toast.error("Couldn't copy the reply.");
  }
}

function ConversationSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-6">
      <span role="status" className="sr-only">
        Loading chat…
      </span>
      <Skeleton aria-hidden="true" className="h-10 w-2/5 self-end rounded-xl" />
      <div aria-hidden="true" className="flex gap-2">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <div className="flex flex-1 flex-col gap-2 pt-1.5">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  );
}
