"use client";

import { cn } from "cn";
import {
  ListOrderedIcon,
  PaperclipIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useErrorToast } from "@/hooks/use-error-toast";
import type { QueueActions } from "@/hooks/use-queue-actions";
import { errorMessage } from "@/lib/errors";
import { isOptimisticQueuedPrompt } from "@/lib/optimistic-prompt";
import type { Id } from "../../../convex/_generated/dataModel";
import type { QueuedPromptView } from "../../../convex/chat/queue";
import { QUEUED_EDIT_RENEW_MS } from "../../../convex/lib/queue";
import { PromptEditor } from "./prompt-editor";

/**
 * The thread's queued prompts, oldest first, above the composer. Each one
 * can have its text edited or be deleted, from the moment it shows. A
 * prompt doesn't start while its editor is open (startQueuedPromptEdit in
 * convex/chat/queue.ts). If it starts anyway, or another tab deletes it, a
 * toast says the edit was lost. A paused queue shows Resume, which `onResume` leaves out while a
 * reply is running. `full` says Send is off until a prompt starts. Shows
 * nothing while the queue is empty.
 */
export function QueueStack({
  prompts,
  paused,
  full,
  actions,
  onResume,
  className,
}: {
  prompts: QueuedPromptView[];
  paused: boolean;
  full: boolean;
  actions: QueueActions;
  onResume?: () => Promise<void>;
  className?: string;
}) {
  const [resuming, setResuming] = useState(false);
  const showError = useErrorToast();
  // The rows whose editor is open, by key. Kept here, so a row that goes
  // away with its editor open still counts as editing.
  const [editingKeys, setEditingKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // The last row that went away with its editor open: it started, or
  // another tab deleted it.
  const [lostEditKey, setLostEditKey] = useState<string | null>(null);
  const lostKey = [...editingKeys].find(
    (key) => !prompts.some((queued) => queued.key === key),
  );
  if (lostKey !== undefined) {
    setEditingKeys(new Set([...editingKeys].filter((key) => key !== lostKey)));
    setLostEditKey(lostKey);
  }
  useEffect(() => {
    if (lostEditKey === null) return;
    toast.error(
      "The prompt you were editing started or was deleted, so your edit was lost.",
    );
  }, [lostEditKey]);

  function setEditing(key: string, editing: boolean) {
    setEditingKeys((keys) => {
      const next = new Set(keys);
      if (editing) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function resume() {
    if (resuming || !onResume) return;
    setResuming(true);
    try {
      await onResume();
    } catch (error) {
      showError(error);
    } finally {
      setResuming(false);
    }
  }

  if (prompts.length === 0) return null;

  return (
    <section
      aria-label="Queued prompts"
      className={cn(
        "mb-2 flex flex-col rounded-xl bg-card text-sm shadow-xs ring-1 ring-foreground/10",
        className,
      )}
    >
      <header className="flex min-h-10 items-center gap-2 px-3 py-1.5">
        {paused ? (
          <PauseIcon className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ListOrderedIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <h2 className="min-w-0 flex-1 truncate font-medium">
          {paused ? "Queue paused" : "Queued"}{" "}
          <span className="font-normal text-muted-foreground">
            {prompts.length}
          </span>
        </h2>
        {paused && onResume && (
          <Button
            variant="outline"
            size="xs"
            disabled={resuming}
            onClick={() => void resume()}
          >
            {resuming ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <PlayIcon data-icon="inline-start" />
            )}
            Resume
          </Button>
        )}
      </header>
      <ol className="max-h-48 overflow-y-auto border-t">
        {prompts.map((queued) => (
          <QueuedPromptRow
            key={queued.key}
            queued={queued}
            editing={editingKeys.has(queued.key)}
            onEditingChange={(editing) => setEditing(queued.key, editing)}
            actions={actions}
          />
        ))}
      </ol>
      {full && (
        <p role="status" className="border-t px-3 py-2 text-muted-foreground">
          The queue is full. Send works again once a prompt starts.
        </p>
      )}
    </section>
  );
}

function QueuedPromptRow({
  queued,
  editing,
  onEditingChange,
  actions,
}: {
  queued: QueuedPromptView;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  actions: QueueActions;
}) {
  const [deleting, setDeleting] = useState(false);
  const { saved, waitForSavedId } = useSavedId(queued._id);

  // Keeps the prompt from starting while its editor is open, once the
  // server has it. If the call fails because the prompt already started,
  // the row goes away and QueueStack says the edit was lost.
  const startEdit = useEffectEvent(() => {
    actions.startEdit(queued._id).catch(() => {});
  });
  const cancelEdit = useEffectEvent(() => {
    actions.cancelEdit(queued._id).catch(() => {});
  });
  useEffect(() => {
    if (!editing || !saved) return;
    startEdit();
    const renew = setInterval(startEdit, QUEUED_EDIT_RENEW_MS);
    // A background tab's timers can run late, so coming back renews too.
    const renewOnShow = () => {
      if (document.visibilityState === "visible") startEdit();
    };
    document.addEventListener("visibilitychange", renewOnShow);
    return () => {
      clearInterval(renew);
      document.removeEventListener("visibilitychange", renewOnShow);
      // After a save or a delete no edit is open, and this does nothing.
      cancelEdit();
    };
  }, [editing, saved]);

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    try {
      await actions.remove(await waitForSavedId());
    } catch (error) {
      toast.error(errorMessage(error));
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <li className="px-2 py-1">
        <PromptEditor
          text={queued.prompt}
          attachmentCount={queued.attachmentCount}
          onSave={async (prompt) => {
            await actions.edit(await waitForSavedId(), prompt);
            onEditingChange(false);
          }}
          onCancel={() => onEditingChange(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex items-center gap-1 py-1 pr-1.5 pl-3 not-last:border-b">
      <p
        className={cn(
          "line-clamp-2 min-w-0 flex-1 py-1 break-words whitespace-pre-wrap",
          !queued.prompt && "text-muted-foreground",
        )}
      >
        {queued.prompt || "Attachments only"}
      </p>
      {queued.attachmentCount > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 px-1 text-xs text-muted-foreground">
          <PaperclipIcon className="size-3" />
          {queued.attachmentCount}
          <span className="sr-only">
            {queued.attachmentCount === 1 ? "attachment" : "attachments"}
          </span>
        </span>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            disabled={deleting}
            onClick={() => onEditingChange(true)}
          >
            <PencilIcon />
            <span className="sr-only">Edit</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Edit</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            disabled={deleting}
            onClick={() => void remove()}
          >
            <XIcon />
            <span className="sr-only">Delete</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Delete</TooltipContent>
      </Tooltip>
    </li>
  );
}

/**
 * Whether the server has saved the queued prompt, and `waitForSavedId`,
 * which resolves to its saved id. Until the Send returns, the stack shows
 * the prompt under a stand-in id, and `waitForSavedId` waits for the saved
 * one. If the Send is refused, the row goes away and it never resolves.
 */
function useSavedId(id: Id<"queuedPrompts">) {
  const saved = !isOptimisticQueuedPrompt(id);
  const waiting = useRef<((id: Id<"queuedPrompts">) => void)[]>([]);
  useEffect(() => {
    if (!saved) return;
    for (const resolve of waiting.current) resolve(id);
    waiting.current = [];
  }, [saved, id]);
  return {
    saved,
    waitForSavedId: () =>
      saved
        ? Promise.resolve(id)
        : new Promise<Id<"queuedPrompts">>((resolve) => {
            waiting.current.push(resolve);
          }),
  };
}