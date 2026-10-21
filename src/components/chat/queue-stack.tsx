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
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useErrorToast } from "@/hooks/use-error-toast";
import { errorMessage } from "@/lib/errors";
import { isOptimisticQueuedPrompt } from "@/lib/optimistic-prompt";
import type { Id } from "../../../convex/_generated/dataModel";
import type { QueuedPromptView } from "../../../convex/chat/queue";
import { PromptEditor } from "./prompt-editor";

/**
 * The thread's queued prompts, oldest first, above the composer. Each one
 * can have its text edited or be deleted. A paused queue shows Resume,
 * which `onResume` leaves out while a reply is running. `full` says Send
 * is off until a prompt starts.
 */
export function QueueStack({
  prompts,
  paused,
  full,
  onEdit,
  onDelete,
  onResume,
  className,
}: {
  prompts: QueuedPromptView[];
  paused: boolean;
  full: boolean;
  onEdit: (
    queuedPromptId: Id<"queuedPrompts">,
    prompt: string,
  ) => Promise<void>;
  onDelete: (queuedPromptId: Id<"queuedPrompts">) => Promise<void>;
  onResume?: () => Promise<void>;
  className?: string;
}) {
  const [resuming, setResuming] = useState(false);
  const showError = useErrorToast();

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
            key={queued._id}
            queued={queued}
            onEdit={(prompt) => onEdit(queued._id, prompt)}
            onDelete={() => onDelete(queued._id)}
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
  onEdit,
  onDelete,
}: {
  queued: QueuedPromptView;
  onEdit: (prompt: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const saved = !isOptimisticQueuedPrompt(queued._id);

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    try {
      await onDelete();
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
            await onEdit(prompt);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
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
            disabled={!saved}
            onClick={() => setEditing(true)}
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
            disabled={!saved || deleting}
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
