"use client";

import { ArrowUpIcon, PaperclipIcon, SquareIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useComposerAttachments,
  type UploadedAttachment,
} from "@/hooks/use-composer-attachments";
import { errorMessage } from "@/lib/errors";
import { ComposerAttachmentChip } from "./attachments";
import { FileDropZone } from "./file-drop-zone";

/**
 * The message box. Enter sends and Shift+Enter adds a line. While `onStop`
 * is set, a Stop button shows in place of Send.
 *
 * When the current model accepts files, they can be attached with the
 * attach button, by pasting them into the box, or by dropping them on the
 * page. A prompt can be just attachments, and Send waits for every upload to
 * finish.
 */
export function Composer({
  onSend,
  onStop,
  disabled = false,
  autoFocus = false,
  className,
}: {
  onSend: (prompt: string, attachments: UploadedAttachment[]) => Promise<void>;
  onStop?: () => Promise<void>;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const [text, setText] = useState("");
  const {
    acceptedMediaTypes,
    attachments,
    addFiles,
    removeAttachment,
    clearAttachments,
    restoreAttachments,
    freePreviews,
  } = useComposerAttachments();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadedAttachments: UploadedAttachment[] = attachments.flatMap(
    ({ fileId, fileUrl, mediaType, filename }) =>
      fileId && fileUrl ? [{ fileId, fileUrl, mediaType, filename }] : [],
  );
  // A failed upload counts as not done, so the user has to remove it first
  // and it isn't left out unnoticed.
  const allUploadsDone = uploadedAttachments.length === attachments.length;
  const canSend =
    !disabled &&
    allUploadsDone &&
    (text.trim() !== "" || attachments.length > 0);

  async function send() {
    if (!canSend) return;
    const prompt = text;
    const attachmentsToSend = attachments;
    setText("");
    clearAttachments();
    try {
      await onSend(prompt, uploadedAttachments);
      freePreviews(attachmentsToSend);
    } catch (error) {
      // Put the prompt back, unless something new was typed meanwhile.
      setText((current) => (current === "" ? prompt : current));
      restoreAttachments(attachmentsToSend);
      toast.error(errorMessage(error));
    }
  }

  async function stop() {
    try {
      await onStop?.();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptedMediaTypes.join(",")}
        multiple
        hidden
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []));
          // Lets the same file be picked again after it's removed.
          event.target.value = "";
        }}
      />
      <FileDropZone
        onDrop={addFiles}
        disabled={acceptedMediaTypes.length === 0}
      />
      <InputGroup>
        {attachments.length > 0 && (
          <InputGroupAddon align="block-start" className="flex-wrap px-2 pt-2">
            {attachments.map((attachment) => (
              <ComposerAttachmentChip
                key={attachment.id}
                attachment={attachment}
                onRemove={() => removeAttachment(attachment)}
              />
            ))}
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            // A screenshot pastes as a file with no text. Text copied from
            // some apps, such as spreadsheets, comes with a picture of it
            // too, so a paste that has text pastes the text.
            const pastedFiles = Array.from(event.clipboardData.files);
            if (
              pastedFiles.length === 0 ||
              event.clipboardData.getData("text/plain")
            ) {
              return;
            }
            event.preventDefault();
            addFiles(pastedFiles);
          }}
          onKeyDown={(event) => {
            // Skip while an IME is composing: its Enter confirms a word.
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send();
            }
          }}
          rows={1}
          autoFocus={autoFocus}
          placeholder="Ask a8 anything…"
          aria-label="Message"
          className="max-h-52 min-h-11 px-3 pt-3"
        />
        <InputGroupAddon align="block-end">
          {acceptedMediaTypes.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <InputGroupButton
                  type="button"
                  size="icon-sm"
                  className="rounded-full"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <PaperclipIcon />
                  <span className="sr-only">Attach files</span>
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>Attach files</TooltipContent>
            </Tooltip>
          )}
          {/* Stop and Send share this spot, so keyboard focus stays put when one replaces the other. */}
          {onStop ? (
            <InputGroupButton
              type="button"
              variant="default"
              size="icon-sm"
              className="ml-auto rounded-full"
              onClick={() => void stop()}
            >
              <SquareIcon className="fill-current" />
              <span className="sr-only">Stop</span>
            </InputGroupButton>
          ) : (
            <InputGroupButton
              type="submit"
              variant="default"
              size="icon-sm"
              className="ml-auto rounded-full"
              disabled={!canSend}
            >
              {disabled ? <Spinner /> : <ArrowUpIcon />}
              <span className="sr-only">Send</span>
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
