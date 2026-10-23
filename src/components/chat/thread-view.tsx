"use client";

import { useMutation } from "convex/react";
import {
  ArchiveIcon,
  CalendarClockIcon,
  MessageSquareOffIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useThreadShortcuts } from "@/components/keyboard-shortcuts";
import { ShareButton } from "@/components/share-dialog";
import { useOpenTemporaryThread } from "@/components/temporary-thread";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useDecideAction } from "@/hooks/use-decide-action";
import { useEditPrompt } from "@/hooks/use-edit-prompt";
import { useQueueActions } from "@/hooks/use-queue-actions";
import { useRegenerateReply } from "@/hooks/use-regenerate-reply";
import { useSendPrompt } from "@/hooks/use-send-prompt";
import { useSetAutoApprove } from "@/hooks/use-set-auto-approve";
import { useSetThreadModel } from "@/hooks/use-set-thread-model";
import { useSetThreadArchived } from "@/hooks/use-set-thread-archived";
import { useReplyStatus } from "@/hooks/use-reply-status";
import { useStableMessages } from "@/hooks/use-stable-messages";
import { useStopReply } from "@/hooks/use-stop-reply";
import {
  MESSAGES_PAGE_SIZE,
  useThreadWithLocalCopy,
} from "@/hooks/use-thread-queries";
import { errorMessage } from "@/lib/errors";
import {
  clearStartingThread,
  useClearStartingThreadOnLeave,
  useStartingThread,
} from "@/lib/starting-threads";
import { lastReplyText } from "@/lib/reply-text";
import { stoppedTurns } from "@/lib/stopped-turns";
import { api } from "../../../convex/_generated/api";
import { MAX_QUEUED_PROMPTS } from "../../../convex/lib/queue";
import {
  ChatHeader,
  StaticThreadHeading,
  TemporaryHeading,
  ThreadHeading,
} from "./chat-header";
import { Composer } from "./composer";
import { ConversationSkeleton } from "./conversation-skeleton";
import { MessageList } from "./message-list";
import { ModelSwitchNotice } from "./model-switch-notice";
import { QueueStack } from "./queue-stack";
import { ThreadActionsProvider } from "./thread-actions-context";

export function ThreadView({ threadId }: { threadId: string }) {
  const {
    thread,
    messages: { results: rawMessages, status, loadMore },
    queue,
    copy,
  } = useThreadWithLocalCopy(threadId);

  // After a reload, marks the thread again, so leaving still deletes it.
  const openTemporaryThread = useOpenTemporaryThread();
  const temporary = thread?.temporary === true;
  useEffect(() => {
    if (temporary) openTemporaryThread(threadId);
  }, [temporary, threadId, openTemporaryThread]);

  // Opening the thread, or a run ending while it's open, clears its unread
  // runs. If that fails, the dot stays and the next open tries again.
  const markRead = useMutation(api.scheduledPrompts.markRead);
  const unread = thread?.unread === true;
  useEffect(() => {
    if (unread) markRead({ threadId }).catch(() => {});
  }, [unread, threadId, markRead]);

  // A thread the new-chat page just started shows as that page left it, not
  // as the skeleton, until its first page loads.
  const startingThread = useStartingThread(threadId);
  const loading = thread === undefined || status === "LoadingFirstPage";
  const showStartingThread = loading && startingThread !== undefined;
  // Until the thread itself loads, the Composer shows what the new-chat
  // page's did.
  const startingComposer =
    thread === undefined ? startingThread : undefined;
  useEffect(() => {
    if (thread === null || !loading) clearStartingThread(threadId);
  }, [thread, loading, threadId]);
  useClearStartingThreadOnLeave(threadId);
  // Until then, a thread opened before shows from the device's copy. It's
  // stale, so nothing that acts on the thread works until live data is in.
  const stale = !showStartingThread && copy !== undefined;
  const shownThread = thread ?? (stale ? copy.thread : undefined);

  const messages = useStableMessages(
    showStartingThread
      ? [startingThread.prompt]
      : stale
        ? copy.messages
        : rawMessages,
  );
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

  const send = useSendPrompt(threadId, sendQueues, thread?.modelId);
  const stop = useStopReply(threadId);
  const regenerate = useRegenerateReply(threadId);
  const edit = useEditPrompt(threadId);
  const decide = useDecideAction(threadId);
  const queueActions = useQueueActions(threadId);
  const setAutoApprove = useSetAutoApprove();
  const setThreadModel = useSetThreadModel();
  // A stopped turn counts as done, and so does a reply that timed out.
  const canRedoLastTurn = !stale && messages.length > 0 && !replyInProgress;
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
    stopReply:
      replyInProgress && !stale
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

  // The page's metadata says "Chat". React puts the <title> that mounts
  // last first in <head>, and this one mounts once the thread loads, after
  // Next's. Matches the "%s · a8" template in the root layout.
  const title = thread?.temporary && <title>Temporary chat · a8</title>;

  if (thread === null) {
    return (
      <>
        {title}
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
      {title}
      <ChatHeader>
        {(thread?.temporary ?? startingThread?.temporary) && (
          <TemporaryHeading />
        )}
        {shownThread && !shownThread.temporary && (
          <>
            {stale ? (
              <StaticThreadHeading title={shownThread.title} />
            ) : (
              <ThreadHeading threadId={threadId} title={shownThread.title} />
            )}
            {shownThread.scheduledPromptId && (
              <Badge variant="secondary" asChild>
                <Link href={`/scheduled#${shownThread.scheduledPromptId}`}>
                  <CalendarClockIcon data-icon="inline-start" />
                  Scheduled
                </Link>
              </Badge>
            )}
            <ShareButton threadId={threadId} title={shownThread.title} />
          </>
        )}
      </ChatHeader>
      {loading && !showStartingThread && !stale ? (
        <ConversationSkeleton />
      ) : (
        <ThreadActionsProvider
          actions={{
            decide: stale ? undefined : decide,
            regenerate: canRedoLastTurn ? regenerate : undefined,
            edit: canRedoLastTurn ? edit : undefined,
            editingLastPrompt,
            setEditingLastPrompt: changeEditingLastPrompt,
          }}
        >
          <MessageList
            messages={messages}
            status={
              stale ? (copy.hasEarlier ? "CanLoadMore" : "Exhausted") : status
            }
            onLoadEarlier={
              stale ? undefined : () => loadMore(MESSAGES_PAGE_SIZE)
            }
            stopped={stopped}
            replyStatus={replyStatus}
          />
        </ThreadActionsProvider>
      )}
      <div className="shrink-0 px-4 pb-4">
        {shownThread?.archived && (
          <ArchivedNotice threadId={threadId} disabled={stale} />
        )}
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
        {thread?.modelSwitch && (
          <div className="mx-auto mb-2 max-w-3xl">
            <ModelSwitchNotice
              threadId={threadId}
              modelSwitch={thread.modelSwitch}
              modelId={thread.modelId}
            />
          </div>
        )}
        <Composer
          onSend={send}
          onStop={replyInProgress && !stale ? stop : undefined}
          disabled={startingComposer !== undefined}
          sendDisabled={queueFull || stale}
          autoApprove={
            (shownThread?.autoApprove ?? startingComposer?.autoApprove) === true
          }
          // Scheduled runs always stop on their cards (ADR 0013). While the
          // thread shows from its copy, the chips show but change nothing.
          onAutoApproveChange={
            thread && !thread.scheduledPromptId
              ? (on) => setAutoApprove({ threadId, on })
              : (stale && !copy.thread.scheduledPromptId) || startingComposer
                ? () => {}
                : undefined
          }
          modelId={shownThread?.modelId ?? startingComposer?.modelId}
          onModelChange={
            thread
              ? (modelId) => setThreadModel({ threadId, modelId })
              : stale || startingComposer
                ? () => {}
                : undefined
          }
          autoFocus
          textareaRef={composerRef}
          className="mx-auto max-w-3xl"
        />
      </div>
    </>
  );
}

/**
 * Says the thread is archived, with a button to move it back. `disabled`
 * turns the button off, while the thread shows from the device's copy.
 */
function ArchivedNotice({
  threadId,
  disabled,
}: {
  threadId: string;
  disabled: boolean;
}) {
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
          disabled={disabled}
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
