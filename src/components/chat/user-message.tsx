"use client";

import { PencilIcon } from "lucide-react";
import { memo } from "react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Message, MessageContent } from "@/components/ui/message";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ThreadMessage } from "@/lib/stopped-turns";
import { ConnectorMention } from "@/components/connectors/connector-mention";
import { getAttachmentKind } from "../../../convex/lib/attachments";
import { splitMentions } from "../../../convex/lib/connectorView";
import { SentImageThumbnail, SentPdfChip } from "./attachments";
import { CopyButton } from "./copy-button";
import { PromptEditor } from "./prompt-editor";
import { useThreadActionsContext } from "./thread-actions-context";

/** Hidden until the pointer is over the message. Always shown on touch. */
const REVEAL_ON_HOVER =
  "text-muted-foreground opacity-0 transition-opacity group-hover/message:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100";

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
            {text && (
              <CopyButton
                text={text}
                label="Copy message"
                className={REVEAL_ON_HOVER}
              />
            )}
            {edit && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={REVEAL_ON_HOVER}
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
                  {splitMentions(text).map((segment, index) =>
                    segment.connector ? (
                      <ConnectorMention
                        key={index}
                        connector={segment.connector}
                      />
                    ) : (
                      segment.text
                    ),
                  )}
                </BubbleContent>
              </Bubble>
            )}
          </div>
        )}
      </MessageContent>
    </Message>
  );
});
