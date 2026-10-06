// See the docs at https://docs.convex.dev/agents/files
import type { ImagePart } from "ai";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { chatModel } from "./agents/chat";
import { requireUser } from "./auth";
import {
  checkAttachmentCount,
  cleanFilename,
  getAcceptedMediaTypes,
  getAttachmentRejectionReason,
} from "./lib/attachments";

// Attaching a file takes three steps. The browser gets an upload URL
// (generateUploadUrl), uploads the file straight to Convex storage, then
// registers it (registerUpload). It goes straight to storage because HTTP
// actions cap request bodies at 20 MB.

/** Why registerUpload refused a file. It returns this instead of throwing. */
const vUploadRejected = v.object({
  code: v.literal("INVALID_ATTACHMENT"),
  message: v.string(),
});

/**
 * The media types the current model accepts as attachments. The composer
 * hides its attach button when the list is empty.
 */
export const capabilities = query({
  args: {},
  returns: v.object({ acceptedMediaTypes: v.array(v.string()) }),
  handler: async () => {
    return { acceptedMediaTypes: getAcceptedMediaTypes(chatModel.provider) };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Registers a file the user uploaded, so a Send can attach it. It checks the
 * file's type and size from the storage metadata, since the browser's checks
 * can be skipped. It then adds the file to the Agent's files table, and
 * records that the user uploaded it.
 *
 * A file it refuses is deleted from storage. It returns the refusal instead
 * of throwing it, because throwing would undo the delete.
 */
export const registerUpload = mutation({
  args: { storageId: v.id("_storage"), filename: v.string() },
  returns: v.union(
    v.object({ fileId: v.string(), fileUrl: v.string() }),
    vUploadRejected,
  ),
  handler: async (ctx, { storageId: uploadedStorageId, filename }) => {
    const user = await requireUser(ctx);
    const storageMetadata = await ctx.db.system.get("_storage", uploadedStorageId);
    if (!storageMetadata) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Upload not found." });
    }
    const safeFilename = cleanFilename(filename);
    const mediaType = storageMetadata.contentType ?? "";
    const rejectionReason = getAttachmentRejectionReason(
      { name: safeFilename, type: mediaType, size: storageMetadata.size },
      getAcceptedMediaTypes(chatModel.provider),
    );
    if (rejectionReason) {
      await ctx.storage.delete(uploadedStorageId);
      return { code: "INVALID_ATTACHMENT" as const, message: rejectionReason };
    }

    // The Agent reuses its row for a file with the same hash and name. That
    // row keeps its own storage object, so this upload isn't needed.
    const agentFile = await ctx.runMutation(components.agent.files.addFile, {
      storageId: uploadedStorageId,
      hash: storageMetadata.sha256,
      filename: safeFilename,
      mediaType,
    });
    const savedStorageId = agentFile.storageId as Id<"_storage">;
    if (savedStorageId !== uploadedStorageId) {
      await ctx.storage.delete(uploadedStorageId);
    }

    const existingAttachment = await ctx.db
      .query("attachments")
      .withIndex("by_userId_and_fileId", (q) =>
        q.eq("userId", user._id).eq("fileId", agentFile.fileId),
      )
      .first();
    if (!existingAttachment) {
      await ctx.db.insert("attachments", {
        userId: user._id,
        fileId: agentFile.fileId,
        storageId: savedStorageId,
      });
    }
    const fileUrl = await ctx.storage.getUrl(savedStorageId);
    if (!fileUrl) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Upload not found." });
    }
    return { fileId: agentFile.fileId, fileUrl };
  },
});

/**
 * Loads the files a Send attaches to its prompt, with an image part for
 * each. Throws unless the user registered every file, there are at most
 * MAX_ATTACHMENTS_PER_PROMPT, and the model accepts each one.
 */
export async function loadPromptAttachments(
  ctx: MutationCtx,
  userId: string,
  fileIds: string[],
) {
  const uniqueFileIds = [...new Set(fileIds)];
  checkAttachmentCount(uniqueFileIds.length);
  const acceptedMediaTypes = getAcceptedMediaTypes(chatModel.provider);

  const attachments = await Promise.all(
    uniqueFileIds.map(async (fileId) => {
      const userAttachment = await ctx.db
        .query("attachments")
        .withIndex("by_userId_and_fileId", (q) =>
          q.eq("userId", userId).eq("fileId", fileId),
        )
        .first();
      const agentFile =
        userAttachment &&
        (await ctx.runQuery(components.agent.files.get, { fileId }));
      const fileUrl =
        agentFile && (await ctx.storage.getUrl(userAttachment.storageId));
      if (!agentFile || !fileUrl) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Attachment not found. Attach it again.",
        });
      }

      const mediaType = agentFile.mediaType ?? "";
      if (!acceptedMediaTypes.includes(mediaType)) {
        throw new ConvexError({
          code: "UNSUPPORTED_ATTACHMENT",
          message: "This model can't read this kind of file.",
        });
      }
      const imagePart: ImagePart = {
        type: "image",
        image: new URL(fileUrl),
        mediaType,
      };
      return { fileId, filename: agentFile.filename ?? "image", imagePart };
    }),
  );

  return {
    fileIds: attachments.map((attachment) => attachment.fileId),
    filenames: attachments.map((attachment) => attachment.filename),
    imageParts: attachments.map((attachment) => attachment.imagePart),
  };
}
