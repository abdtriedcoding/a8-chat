// See the docs at https://docs.convex.dev/agents/files
import { getFile } from "@convex-dev/agent";
import { v, type Infer } from "convex/values";
import { appError, ERROR_CODES } from "../lib/errors";
import { components } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import { chatModel } from "../agents/chat";
import {
  checkAttachmentCount,
  getAcceptedMediaTypes,
  UNNAMED_FILE,
} from "../lib/attachments";

/**
 * Why a Send refused an attachment: the user didn't upload it, or
 * cleanUpUnsentUploads (convex/attachments/cleanup.ts) deleted it. The Send
 * mutations return it instead of throwing, like a rate limit.
 */
export const vAttachmentNotFound = v.object({
  code: v.literal(ERROR_CODES.NOT_FOUND),
  message: v.string(),
});

export type AttachmentNotFound = Infer<typeof vAttachmentNotFound>;

/**
 * Loads the files a Send attaches to its prompt, with a message part for
 * each: an image part for an image, and a file part for a PDF. Returns
 * AttachmentNotFound if the user didn't register a file, or it's been
 * deleted.
 *
 * Throws if there are more than MAX_ATTACHMENTS_PER_PROMPT files, or the
 * model doesn't accept one. The browser checks both before uploading, so only
 * a call that skips it gets these.
 *
 * The parts carry the files' storage URLs. The model's provider fetches the
 * files from there, so the reply runner never loads them.
 */
export async function loadPromptAttachments(
  ctx: MutationCtx,
  userId: string,
  fileIds: string[],
) {
  const uniqueFileIds = [...new Set(fileIds)];
  checkAttachmentCount(uniqueFileIds.length);
  const acceptedMediaTypes = getAcceptedMediaTypes(chatModel.provider);

  const loadedAttachments = await Promise.all(
    uniqueFileIds.map(async (fileId) => {
      const userAttachment = await ctx.db
        .query("attachments")
        .withIndex("by_userId_and_fileId", (q) =>
          q.eq("userId", userId).eq("fileId", fileId),
        )
        .first();
      if (!userAttachment) return null;
      const agentFile = await getFile(ctx, components.agent, fileId).catch(
        rethrowUnlessFileNotFound,
      );
      if (!agentFile) return null;

      const { file, filePart, imagePart } = agentFile;
      if (!acceptedMediaTypes.includes(filePart.mediaType)) {
        throw appError(
          ERROR_CODES.UNSUPPORTED_ATTACHMENT,
          "This model can't read this kind of file.",
        );
      }
      // getFile's parts hold the file's URL. Don't swap in the bytes. The
      // Agent stores inline bytes over 64 KB as its own file, with no
      // attachments row, and cleanUpOrphanedStorage would delete it a day
      // later.
      return {
        fileId,
        filename: file.filename ?? UNNAMED_FILE,
        part: imagePart ?? filePart,
      };
    }),
  );
  const attachments = loadedAttachments.filter(
    (attachment) => attachment !== null,
  );
  if (attachments.length < loadedAttachments.length) {
    const notFound: AttachmentNotFound = {
      code: ERROR_CODES.NOT_FOUND,
      message: "Attachment not found. Attach it again.",
    };
    return notFound;
  }

  return {
    fileIds: attachments.map((attachment) => attachment.fileId),
    filenames: attachments.map((attachment) => attachment.filename),
    parts: attachments.map((attachment) => attachment.part),
  };
}

/**
 * Returns null for the error getFile throws when the Agent's file row or its
 * storage object is gone, and rethrows any other error.
 */
function rethrowUnlessFileNotFound(error: unknown): null {
  if (error instanceof Error && error.message.startsWith("File not found")) {
    return null;
  }
  throw error;
}
