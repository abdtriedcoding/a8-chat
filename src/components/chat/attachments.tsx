"use client";

/* eslint-disable @next/next/no-img-element -- Attachments are the user's
   files, served from Convex storage or previewed from a local blob URL.
   next/image would only add an optimizer copy and dev warnings. */

import { CircleAlertIcon, XIcon } from "lucide-react";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ComposerAttachment } from "@/hooks/use-composer-attachments";

/** A file in the composer, with its upload status and a remove button. */
export function ComposerAttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: ComposerAttachment;
  onRemove: () => void;
}) {
  const { filename, sizeInBytes, previewUrl, uploadStatus, uploadError } =
    attachment;
  return (
    <Attachment state={uploadStatus} size="sm" className="max-w-56">
      {uploadStatus === "error" ? (
        <AttachmentMedia>
          <CircleAlertIcon />
        </AttachmentMedia>
      ) : (
        <AttachmentMedia variant="image">
          <img src={previewUrl} alt="" />
        </AttachmentMedia>
      )}
      <AttachmentContent>
        <AttachmentTitle>{filename}</AttachmentTitle>
        <AttachmentDescription>
          {uploadStatus === "uploading"
            ? "Uploading…"
            : uploadStatus === "error"
              ? uploadError
              : formatFileSize(sizeInBytes)}
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction onClick={onRemove}>
          <XIcon />
          <span className="sr-only">Remove {filename}</span>
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  );
}

/** An image sent with a prompt. Clicking it opens it full size. */
export function SentImageThumbnail({ imageUrl }: { imageUrl: string }) {
  return (
    <Dialog>
      <Attachment orientation="vertical" className="w-20">
        <AttachmentMedia variant="image">
          <img src={imageUrl} alt="" />
        </AttachmentMedia>
        <DialogTrigger asChild>
          <AttachmentTrigger>
            <span className="sr-only">Open image</span>
          </AttachmentTrigger>
        </DialogTrigger>
      </Attachment>
      <DialogContent
        aria-describedby={undefined}
        className="w-fit gap-0 p-2 pt-12 sm:max-w-none"
      >
        <DialogTitle className="sr-only">Attached image</DialogTitle>
        {/* Sized in viewport units, since a percentage width inside the
            w-fit dialog shrinks the image. */}
        <img
          src={imageUrl}
          alt="Attached image"
          className="max-h-[calc(100dvh-8rem)] max-w-[min(62rem,calc(100vw-3rem))] rounded-lg"
        />
      </DialogContent>
    </Dialog>
  );
}

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

/** "820 KB", "2.4 MB". */
function formatFileSize(sizeInBytes: number): string {
  if (sizeInBytes < BYTES_PER_MB) {
    return `${Math.max(1, Math.round(sizeInBytes / BYTES_PER_KB))} KB`;
  }
  return `${(sizeInBytes / BYTES_PER_MB).toFixed(1)} MB`;
}
