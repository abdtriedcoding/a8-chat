"use client";

import { cn } from "cn";
import { ArrowUpIcon, PaperclipIcon, SquareIcon } from "lucide-react";
import { useRef, useState, type Ref } from "react";
import { toast } from "sonner";
import { ConnectorLogo } from "@/components/connectors/connector-logo";
import { ReconnectButton } from "@/components/connectors/reconnect-button";
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
import { useComposerDictation } from "@/hooks/use-composer-dictation";
import { useComposerMentions } from "@/hooks/use-composer-mentions";
import { useErrorToast } from "@/hooks/use-error-toast";
import { useRestoredDraft } from "@/hooks/use-restored-draft";
import { errorMessage } from "@/lib/errors";
import { ComposerAttachmentChip } from "./attachments";
import { AutoApproveChip } from "./auto-approve-chip";
import { CreditNotice } from "./credit-notice";
import { DictationButton } from "./dictation-button";
import { FileDropZone } from "./file-drop-zone";
import { MentionHighlights } from "./mention-highlights";
import { MentionMenu } from "./mention-menu";

/**
 * The message box's padding and text size, which MentionHighlights copies
 * so its lines wrap where the box's do. py-2 is InputGroupTextarea's.
 */
const TEXT_BOX = "px-3 pt-3 pb-2 text-base md:text-sm";

/**
 * The message box. Enter sends and Shift+Enter adds a line. While `onStop`
 * is set, a Stop button shows next to Send. `disabled` turns Send off with
 * a spinner, for a Send in flight, and `sendDisabled` turns it off without
 * one. `initialText` is read on mount only, so give the box a new key to
 * start it with other text.
 *
 * When the current model accepts files, they can be attached with the
 * attach button, by pasting them into the box, or by dropping them on the
 * page. A prompt can be just attachments, and Send waits for every upload to
 * finish.
 *
 * Typing @ opens a menu of connectors to mention (useComposerMentions). A
 * prompt that mentions a connector that isn't connected can't be sent, and
 * a button above the text signs in to it. The sign-in comes back to this
 * page, and the box gets its text back on mount (useRestoredDraft).
 *
 * The mic dictates into the box (useComposerDictation) when the deployment
 * has dictation set up. Typing, Esc or the mic stops it, and a Send while
 * dictating waits for the last words (useDictation's stop).
 *
 * While `onAutoApproveChange` is set, the toolbar has the auto-approve chip
 * (AutoApproveChip), on while `autoApprove` is.
 *
 * On the hosted a8, a notice above the box says when the user is out of
 * credits or low on them (CreditNotice).
 *
 * The box is marked data-composer, plus data-empty while it holds no text
 * and no attachments, for ↑ in KeyboardShortcutsProvider.
 */
export function Composer({
  initialText = "",
  onSend,
  onStop,
  disabled = false,
  sendDisabled = false,
  autoFocus = false,
  textareaRef,
  autoApprove = false,
  onAutoApproveChange,
  className,
}: {
  initialText?: string;
  onSend: (prompt: string, attachments: UploadedAttachment[]) => Promise<void>;
  onStop?: () => Promise<void>;
  disabled?: boolean;
  sendDisabled?: boolean;
  autoFocus?: boolean;
  textareaRef?: Ref<HTMLTextAreaElement>;
  autoApprove?: boolean;
  onAutoApproveChange?: (on: boolean) => Promise<unknown> | void;
  className?: string;
}) {
  const [text, setText] = useState(initialText);
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
  const formRef = useRef<HTMLFormElement>(null);
  const highlightsRef = useRef<HTMLDivElement>(null);
  const showError = useErrorToast();
  const mentions = useComposerMentions({ text, setText });
  const dictation = useComposerDictation({
    text,
    setText,
    getTextarea: () =>
      formRef.current?.querySelector<HTMLTextAreaElement>("[data-composer]") ??
      null,
  });

  useRestoredDraft(setText);

  const uploadedAttachments: UploadedAttachment[] = attachments.flatMap(
    ({ fileId, fileUrl, mediaType, filename }) =>
      fileId && fileUrl ? [{ fileId, fileUrl, mediaType, filename }] : [],
  );
  // A failed upload counts as not done, so the user has to remove it first
  // and it isn't left out unnoticed.
  const allUploadsDone = uploadedAttachments.length === attachments.length;
  const canSend =
    !disabled &&
    !sendDisabled &&
    allUploadsDone &&
    mentions.canSend &&
    (text.trim() !== "" || attachments.length > 0);

  async function send() {
    if (!canSend) return;
    const prompt = dictation.active ? await dictation.finish() : text;
    // Null when another Send is already waiting for the last words.
    if (prompt === null) return;
    if (prompt.trim() === "" && attachments.length === 0) return;
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
      showError(error);
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
      ref={formRef}
      className={cn("relative", className)}
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
          void addFiles(Array.from(event.target.files ?? []));
          // Lets the same file be picked again after it's removed.
          event.target.value = "";
        }}
      />
      <FileDropZone
        onDrop={addFiles}
        disabled={acceptedMediaTypes.length === 0}
      />
      {mentions.options.length > 0 && (
        <MentionMenu
          id={mentions.menuId}
          options={mentions.options}
          selectedId={mentions.selectedId}
          onSelectedChange={mentions.setSelectedId}
          onPick={mentions.pick}
        />
      )}
      <CreditNotice className="mb-2" />
      <InputGroup>
        {mentions.blockedMentions.length > 0 && (
          <InputGroupAddon
            align="block-start"
            className="flex-col items-stretch gap-1.5 px-3 pt-2.5"
          >
            {mentions.blockedMentions.map((connector) => (
              <div
                key={connector.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-normal"
              >
                <ConnectorLogo connector={connector} size="sm" />
                <span className="min-w-0 flex-1">
                  {connector.status === "needs_reconnect"
                    ? `${connector.name} needs reconnecting before this can be sent.`
                    : connector.setUp
                      ? `${connector.name} isn't connected, so this can't be sent yet.`
                      : `${connector.name} isn't set up on this deployment, so this can't be sent.`}
                </span>
                {(connector.setUp || connector.status !== "disconnected") && (
                  <ReconnectButton
                    connector={connector}
                    draft={text}
                    render={<InputGroupButton variant="outline" size="xs" />}
                  >
                    {connector.status === "needs_reconnect"
                      ? "Reconnect"
                      : "Connect"}{" "}
                    {connector.name}
                  </ReconnectButton>
                )}
              </div>
            ))}
          </InputGroupAddon>
        )}
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
        <div className="relative w-full">
          <MentionHighlights
            ref={highlightsRef}
            text={text}
            blockedIds={mentions.blockedMentions.map(({ id }) => id)}
            className={TEXT_BOX}
          />
          <InputGroupTextarea
            ref={textareaRef}
            onScroll={(event) => {
              if (highlightsRef.current) {
                highlightsRef.current.scrollTop = event.currentTarget.scrollTop;
              }
            }}
            data-composer=""
            data-empty={
              text === "" && attachments.length === 0 ? "" : undefined
            }
            value={text}
            onChange={(event) => {
              dictation.stopForTyping();
              setText(event.target.value);
              mentions.syncCaret(event.target);
            }}
            {...mentions.comboboxProps}
            {...mentions.caretHandlers}
            onFocus={(event) => {
              mentions.caretHandlers.onFocus(event);
              dictation.prewarm();
            }}
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
              void addFiles(pastedFiles);
            }}
            onKeyDown={(event) => {
              if (mentions.onKeyDown(event)) return;
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
            // relative paints the box over the highlights.
            className={cn("no-scrollbar relative max-h-52 min-h-11", TEXT_BOX)}
          />
        </div>
        <InputGroupAddon align="block-end">
          {acceptedMediaTypes.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <InputGroupButton
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <PaperclipIcon />
                  <span className="sr-only">Attach files</span>
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>Attach files</TooltipContent>
            </Tooltip>
          )}
          {onAutoApproveChange && (
            <AutoApproveChip
              on={autoApprove}
              onChange={onAutoApproveChange}
              disabled={disabled}
            />
          )}
          <div className="ml-auto flex items-center gap-2">
            {dictation.available && (
              <DictationButton
                state={dictation.state}
                level={dictation.level}
                onToggle={dictation.toggle}
                onWarmUp={() => dictation.prewarm({ likely: true })}
              />
            )}
            {onStop && (
              <InputGroupButton
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => void stop()}
              >
                <SquareIcon className="fill-current" />
                <span className="sr-only">Stop</span>
              </InputGroupButton>
            )}
            <InputGroupButton
              type="submit"
              variant="default"
              size="icon-sm"
              disabled={!canSend}
            >
              {disabled ? <Spinner /> : <ArrowUpIcon />}
              <span className="sr-only">Send</span>
            </InputGroupButton>
          </div>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
