import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { api } from "../../convex/_generated/api";
import {
  getAttachmentRejectionReason,
  MAX_ATTACHMENTS_PER_PROMPT,
} from "../../convex/lib/attachments";

/** A file in the composer, from the moment the user picks it. */
export type ComposerAttachment = {
  /** A local id for the composer. The server never sees it. */
  id: string;
  filename: string;
  sizeInBytes: number;
  mediaType: string;
  /** A blob URL for the file, so the chip shows it during the upload. */
  previewUrl: string;
  uploadStatus: "uploading" | "done" | "error";
  /** Set once the upload is done. */
  fileId?: string;
  /** Set once the upload is done. Where Convex storage serves the file. */
  fileUrl?: string;
  /** Set when the upload failed. */
  uploadError?: string;
};

/** A file that finished uploading, as a Send takes it. */
export type UploadedAttachment = {
  fileId: string;
  fileUrl: string;
  mediaType: string;
};

/**
 * The composer's attachments. `addFiles` checks each file, then uploads it
 * to Convex storage and registers it (convex/attachments.ts).
 * `acceptedMediaTypes` lists the media types the current model takes, and
 * is empty while it loads.
 */
export function useComposerAttachments() {
  const capabilities = useQuery(api.attachments.capabilities);
  const acceptedMediaTypes = capabilities?.acceptedMediaTypes ?? [];
  const generateUploadUrl = useMutation(api.attachments.generateUploadUrl);
  const registerUpload = useAction(api.attachments.registerUpload);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);

  // The attachments as of the last change, ahead of the next render. Two
  // picks can land before React re-renders, so addFiles counts free slots
  // from this rather than from `attachments`. Every change goes through
  // changeAttachments, which keeps the two in step.
  const latestAttachments = useRef<ComposerAttachment[]>([]);
  function changeAttachments(
    change: (currentAttachments: ComposerAttachment[]) => ComposerAttachment[],
  ) {
    latestAttachments.current = change(latestAttachments.current);
    setAttachments(latestAttachments.current);
  }

  // Every preview URL not freed yet, so they're all freed on unmount.
  const previewUrlsInUse = useRef(new Set<string>());
  useEffect(() => {
    const previewUrls = previewUrlsInUse.current;
    return () => {
      for (const previewUrl of previewUrls) URL.revokeObjectURL(previewUrl);
      previewUrls.clear();
    };
  }, []);

  function updateAttachment(
    attachmentId: string,
    changes: Partial<ComposerAttachment>,
  ) {
    changeAttachments((currentAttachments) =>
      currentAttachments.map((attachment) =>
        attachment.id === attachmentId
          ? { ...attachment, ...changes }
          : attachment,
      ),
    );
  }

  async function uploadFile(attachmentId: string, file: File) {
    try {
      const uploadUrl = await generateUploadUrl();
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.status}`);
      }
      const { storageId } = await uploadResponse.json();
      const registration = await registerUpload({
        storageId,
        filename: file.name,
      });
      if ("code" in registration) throw new ConvexError(registration);
      updateAttachment(attachmentId, {
        uploadStatus: "done",
        fileId: registration.fileId,
        fileUrl: registration.fileUrl,
      });
    } catch (error) {
      updateAttachment(attachmentId, {
        uploadStatus: "error",
        uploadError:
          error instanceof ConvexError ? errorMessage(error) : "Upload failed.",
      });
    }
  }

  /**
   * Checks the files and starts uploading the ones that pass. The rest are
   * refused with a toast, before any upload.
   */
  function addFiles(files: File[]) {
    const freeSlots =
      MAX_ATTACHMENTS_PER_PROMPT - latestAttachments.current.length;
    const newAttachments: ComposerAttachment[] = [];
    for (const file of files) {
      const rejectionReason = getAttachmentRejectionReason(
        file,
        acceptedMediaTypes,
      );
      if (rejectionReason) {
        toast.error(rejectionReason);
        continue;
      }
      if (newAttachments.length === freeSlots) {
        toast.error(
          `You can attach at most ${MAX_ATTACHMENTS_PER_PROMPT} files.`,
        );
        break;
      }
      const previewUrl = URL.createObjectURL(file);
      previewUrlsInUse.current.add(previewUrl);
      const attachmentId = crypto.randomUUID();
      newAttachments.push({
        id: attachmentId,
        filename: file.name,
        sizeInBytes: file.size,
        mediaType: file.type,
        previewUrl,
        uploadStatus: "uploading",
      });
      void uploadFile(attachmentId, file);
    }
    changeAttachments((currentAttachments) => [
      ...currentAttachments,
      ...newAttachments,
    ]);
  }

  /** Frees the attachments' preview URLs. Call it once they're gone for good. */
  function freePreviews(attachmentsToFree: ComposerAttachment[]) {
    for (const { previewUrl } of attachmentsToFree) {
      URL.revokeObjectURL(previewUrl);
      previewUrlsInUse.current.delete(previewUrl);
    }
  }

  function removeAttachment(attachmentToRemove: ComposerAttachment) {
    changeAttachments((currentAttachments) =>
      currentAttachments.filter(
        (attachment) => attachment.id !== attachmentToRemove.id,
      ),
    );
    freePreviews([attachmentToRemove]);
  }

  /** Empties the composer but keeps the previews, so a failed Send can restore them. */
  function clearAttachments() {
    changeAttachments(() => []);
  }

  /** Puts attachments back in front of any added since they were cleared. */
  function restoreAttachments(attachmentsToRestore: ComposerAttachment[]) {
    changeAttachments((currentAttachments) => [
      ...attachmentsToRestore,
      ...currentAttachments,
    ]);
  }

  return {
    acceptedMediaTypes,
    attachments,
    addFiles,
    removeAttachment,
    clearAttachments,
    restoreAttachments,
    freePreviews,
  };
}
