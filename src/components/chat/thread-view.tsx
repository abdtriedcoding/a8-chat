"use client";

import { useUIMessages } from "@convex-dev/agent/react";
import { useConvexAuth, useQuery } from "convex/react";
import { ArchiveIcon, MessageSquareOffIcon } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useThreadShortcuts } from "@/components/keyboard-shortcuts";
import { ShareButton } from "@/components/share-dialog";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
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
import { useDecideAction } from "@/hooks/use-decide-action";
import { useEditPrompt } from "@/hooks/use-edit-prompt";
import { useQueueActions } from "@/hooks/use-queue-actions";
import { useRegenerateReply } from "@/hooks/use-regenerate-reply";
import { useSendPrompt } from "@/hooks/use-send-prompt";
import { useSetThreadArchived } from "@/hooks/use-set-thread-archived";
import { useReplyStatus } from "@/hooks/use-reply-status";
import { useStableMessages } from "@/hooks/use-stable-messages";
import { useStopReply } from "@/hooks/use-stop-reply";
import { errorMessage } from "@/lib/errors";
import { lastReplyText } from "@/lib/reply-text";
import { stoppedTurns } from "@/lib/stopped-turns";
import { api } from "../../../convex/_generated/api";
import { MAX_QUEUED_PROMPTS } from "../../../convex/lib/queue";
import { ChatHeader, ThreadHeading } from "./chat-header";
import { Composer } from "./composer";
import { MessageList } from "./message-list";
import { QueueStack } from "./queue-stack";
import { ThreadActionsProvider } from "./thread-actions-context";

const PAGE_SIZE = 20;

export function ThreadView({ threadId }: { threadId: string }) {
  const { isAuthenticated } = useConvexAuth();
  const thread = useQuery(
    api.threads.get,
    isAuthenticated ? { threadId } : "skip",
  );

  const {
    results: rawMessages,
    status,
    loadMore,
  } = useUIMessages(
    api.chat.messages.listThreadMessages,
    isAuthenticated && thread !== null ? { threadId } : "skip",
    { initialNumItems: PAGE_SIZE, stream: true },
  );

  const queue = useQuery(
    api.chat.queue.getQueue,
    isAuthenticated && thread !== null ? { threadId } : "skip",
  );

  const messages = useStableMessages(rawMessages);
  const stopped = stoppedTurns(messages);
  const replyStatus = useReplyStatus(messages, stopped);
  const replyInProgress =
    replyStatus === "waiting" ||
    replyStatus === "continuing" ||
    replyStatus === "streaming";

  const queuedPrompts = queue?.prompts ?? [];
  // A reply that timed out never started the queue, so Resume has to.
  const queuePaused =
    queuedPrompts.length > 0 &&
    (queue?.paused === true || replyStatus === "timedOut");
  // The server decides for itself, and queues behind a queue that timed out
  // with the rest. This guess picks where the prompt shows until it answers.
  const sendQueues =
    replyInProgress || (queuedPrompts.length > 0 && queue?.paused !== true);
  const queueFull = sendQueues && queuedPrompts.length >= MAX_QUEUED_PROMPTS;

  const send = useSendPrompt(threadId, sendQueues);
  const stop = useStopReply(threadId);
  const regenerate = useRegenerateReply(threadId);
  const edit = useEditPrompt(threadId);
  const decide = useDecideAction(threadId);
  const queueActions = useQueueActions(threadId);
  // A stopped turn counts as done, and so does a reply that timed out.
  const canRedoLastTurn = messages.length > 0 && !replyInProgress;
  const copyableText = lastReplyText(messages, stopped);

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

  useThreadShortcuts({
    stopReply: replyInProgress
      ? () => {
          stop().catch((error: unknown) => toast.error(errorMessage(error)));
        }
      : undefined,
    editLastPrompt: canRedoLastTurn
      ? () => changeEditingLastPrompt(true, true)
      : undefined,
    copyLastReply: copyableText
      ? () => void copyReply(copyableText)
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
        {thread && (
          <>
            <ThreadHeading threadId={threadId} title={thread.title} />
            <ShareButton threadId={threadId} title={thread.title} />
          </>
        )}
      </ChatHeader>
      {thread === undefined || status === "LoadingFirstPage" ? (
        <ConversationSkeleton />
      ) : (
        <ThreadActionsProvider
          actions={{
            decide,
            regenerate: canRedoLastTurn ? regenerate : undefined,
            edit: canRedoLastTurn ? edit : undefined,
            editingLastPrompt,
            setEditingLastPrompt: changeEditingLastPrompt,
          }}
        >
          <MessageList
            messages={messages}
            status={status}
            onLoadEarlier={() => loadMore(PAGE_SIZE)}
            stopped={stopped}
            replyStatus={replyStatus}
          />
        </ThreadActionsProvider>
      )}
      <div className="shrink-0 px-4 pb-4">
        {thread?.archived && <ArchivedNotice threadId={threadId} />}
        {queuedPrompts.length > 0 && (
          <QueueStack
            prompts={queuedPrompts}
            paused={queuePaused}
            full={queueFull}
            onEdit={queueActions.edit}
            onDelete={queueActions.remove}
            onResume={replyInProgress ? undefined : queueActions.resume}
            className="mx-auto max-w-3xl"
          />
        )}
        <Composer
          onSend={send}
          onStop={replyInProgress ? stop : undefined}
          sendDisabled={queueFull}
          autoFocus
          textareaRef={composerRef}
          className="mx-auto max-w-3xl"
        />
      </div>
    </>
  );
}

/** Says the thread is archived, with a button to move it back. */
function ArchivedNotice({ threadId }: { threadId: string }) {
  const setThreadArchived = useSetThreadArchived();
  return (
    <Alert role="status" className="mx-auto mb-2 max-w-3xl pr-30">
      <ArchiveIcon />
      <AlertTitle>This chat is archived</AlertTitle>
      <AlertDescription>
        Sending a message moves it back to your chats.
      </AlertDescription>
      <AlertAction>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setThreadArchived({ threadId, archived: false }).catch(
              (error: unknown) => toast.error(errorMessage(error)),
            );
          }}
        >
          Unarchive
        </Button>
      </AlertAction>
    </Alert>
  );
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
