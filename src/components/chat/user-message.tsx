"use client";

import { PencilIcon } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Message, MessageContent } from "@/components/ui/message";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/errors";
import type { ThreadMessage } from "@/lib/stopped-turns";
import { getAttachmentKind } from "../../../convex/lib/attachments";
import { checkPrompt } from "../../../convex/lib/prompt";
import { SentImageThumbnail, SentPdfChip } from "./attachments";
import { useThreadActionsContext } from "./thread-actions-context";

/**
 * A prompt's bubble, with its attachments above it. On the last prompt, while
 * it can be edited, a pencil next to it opens an editor in its place. Editing
 * changes only the text. The thread owns whether the editor is open, so a
 * shortcut can open it too.
 */
export const UserMessage = memo(function UserMessage({
  text,
  parts,
  lastPrompt = false,
}: {
  text: string;
  /** All the prompt's parts. Its file parts show as attachments. */
  parts: ThreadMessage["parts"];
  lastPrompt?: boolean;
}) {
  const {
    edit: editLastPrompt,
    editingLastPrompt,
    setEditingLastPrompt,
  } = useThreadActionsContext();
  const edit = lastPrompt ? editLastPrompt : undefined;
  const attachments = parts.filter((part) => part.type === "file");
  return (
    <Message align="end">
      <MessageContent>
        {attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {attachments.map((attachment, index) =>
              getAttachmentKind(attachment.mediaType) === "image" ? (
                <SentImageThumbnail
                  key={`${index}-${attachment.url}`}
                  imageUrl={attachment.url}
                />
              ) : (
                <SentPdfChip
                  key={`${index}-${attachment.url}`}
                  fileUrl={attachment.url}
                  filename={attachment.filename ?? "PDF"}
                />
              ),
            )}
          </div>
        )}
        {edit && editingLastPrompt ? (
          <PromptEditor
            text={text}
            attachmentCount={attachments.length}
            onSave={async (prompt) => {
              await edit(prompt);
              setEditingLastPrompt(false);
            }}
            onCancel={() => setEditingLastPrompt(false)}
          />
        ) : (
          <div className="flex items-end justify-end gap-1">
            {edit && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground opacity-0 transition-opacity group-hover/message:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                    onClick={() => setEditingLastPrompt(true)}
                  >
                    <PencilIcon />
                    <span className="sr-only">Edit</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit</TooltipContent>
              </Tooltip>
            )}
            {/* A prompt can be just attachments. */}
            {text && (
              <Bubble variant="tinted" align="end">
                <BubbleContent className="whitespace-pre-wrap">
                  {text}
                </BubbleContent>
              </Bubble>
            )}
          </div>
        )}
      </MessageContent>
    </Message>
  );
});

/**
 * Edits a prompt's text. Enter saves, Shift+Enter adds a line, and Esc
 * cancels. Saving the same text cancels too, so it doesn't ask for a new
 * reply.
 */
function PromptEditor({
  text,
  attachmentCount,
  onSave,
  onCancel,
}: {
  text: string;
  attachmentCount: number;
  onSave: (prompt: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(text);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Opens with the cursor after the text.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      // The server runs the same check. Running it here first refuses a
      // blank edit without a failed call, which the Convex client would log
      // as a console error.
      const prompt = checkPrompt(draft, attachmentCount);
      if (prompt === text) onCancel();
      else await onSave(prompt);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    // The padding makes room for the focus ring. The list item paints
    // nothing outside itself (content-visibility: auto).
    <form
      className="w-full p-1"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <InputGroup>
        <InputGroupTextarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            } else if (
              // Skip while an IME is composing: its Enter confirms a word.
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void save();
            }
          }}
          rows={1}
          aria-label="Edit message"
          className="max-h-52 min-h-11 px-3 pt-3"
        />
        <InputGroupAddon align="block-end" className="justify-end">
          <InputGroupButton size="sm" onClick={onCancel}>
            Cancel
          </InputGroupButton>
          <InputGroupButton type="submit" variant="default" size="sm">
            {saving && <Spinner data-icon="inline-start" />}
            Save
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
