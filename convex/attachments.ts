// See the docs at https://docs.convex.dev/agents/files
import type { FilePart, ImagePart } from "ai";
import { ConvexError, v, type Infer } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import { chatModel } from "./agents/chat";
import { requireUser } from "./auth";
import {
  checkAttachmentCount,
  cleanFilename,
  detectMediaType,
  FILE_SIGNATURE_LENGTH,
  getAcceptedMediaTypes,
  getAttachmentKind,
  getAttachmentRejectionReason,
  UNNAMED_FILE,
} from "./lib/attachments";

// Attaching a file takes three steps. The browser gets an upload URL
// (generateUploadUrl), uploads the file straight to Convex storage, then
// registers it (registerUpload). It goes straight to storage because HTTP
// actions cap request bodies at 20 MB.

const vRegisteredUpload = v.object({ fileId: v.string(), fileUrl: v.string() });

/** Why registerUpload refused a file. It returns this instead of throwing. */
const vUploadRejected = v.object({
  code: v.literal("INVALID_ATTACHMENT"),
  message: v.string(),
});

/**
 * Why a Send refused an attachment: the user didn't upload it, or
 * cleanUpUnsentUploads deleted it. The Send mutations return it instead of
 * throwing, like a rate limit.
 */
export const vAttachmentNotFound = v.object({
  code: v.literal("NOT_FOUND"),
  message: v.string(),
});

type RegisteredUpload = Infer<typeof vRegisteredUpload>;
type UploadRejected = Infer<typeof vUploadRejected>;
export type AttachmentNotFound = Infer<typeof vAttachmentNotFound>;

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
 * Registers a file the user uploaded, so a Send can attach it. The browser's
 * checks can be skipped, so it checks the file again:
 * - the type the upload declared, and the size, from the storage metadata
 * - the type the file's first bytes show, which is the type it's saved with
 *
 * It's an action because only actions can read a stored file. saveUpload
 * then adds the file to the Agent's files table, and records that the user
 * uploaded it.
 *
 * A file it refuses is deleted from storage. It returns the refusal instead
 * of throwing it, because the Convex client logs every thrown error to the
 * browser console.
 */
export const registerUpload = action({
  args: { storageId: v.id("_storage"), filename: v.string() },
  returns: v.union(vRegisteredUpload, vUploadRejected),
  handler: async (
    ctx,
    { storageId, filename },
  ): Promise<RegisteredUpload | UploadRejected> => {
    if (!(await ctx.auth.getUserIdentity())) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "Please sign in to continue.",
      });
    }
    const storageMetadata = await ctx.runQuery(
      internal.attachments.getStorageMetadata,
      { storageId },
    );
    if (!storageMetadata) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Upload not found." });
    }
    const safeFilename = cleanFilename(filename);
    const acceptedMediaTypes = getAcceptedMediaTypes(chatModel.provider);

    // The declared type is checked first, so an upload over its type's size
    // limit is refused without being read.
    const declaredTypeRejection = getAttachmentRejectionReason(
      {
        name: safeFilename,
        type: storageMetadata.contentType ?? "",
        size: storageMetadata.size,
      },
      acceptedMediaTypes,
    );
    if (declaredTypeRejection) {
      return await rejectUpload(ctx, storageId, declaredTypeRejection);
    }

    // An empty type, for bytes that match no type a8 takes, is refused here.
    const detectedMediaType = (await readMediaType(ctx, storageId)) ?? "";
    const detectedTypeRejection = getAttachmentRejectionReason(
      { name: safeFilename, type: detectedMediaType, size: storageMetadata.size },
      acceptedMediaTypes,
    );
    if (detectedTypeRejection) {
      return await rejectUpload(ctx, storageId, detectedTypeRejection);
    }

    return await ctx.runMutation(internal.attachments.saveUpload, {
      storageId,
      filename: safeFilename,
      mediaType: detectedMediaType,
      sha256: storageMetadata.sha256,
    });
  },
});

/** The media type the stored file's first bytes show (detectMediaType). */
async function readMediaType(ctx: ActionCtx, storageId: Id<"_storage">) {
  const storedFile = await ctx.storage.get(storageId);
  if (!storedFile) return null;
  const firstBytes = await storedFile
    .slice(0, FILE_SIGNATURE_LENGTH)
    .arrayBuffer();
  return detectMediaType(new Uint8Array(firstBytes));
}

/** Deletes a refused upload from storage, and returns the refusal. */
async function rejectUpload(
  ctx: ActionCtx,
  storageId: Id<"_storage">,
  rejectionReason: string,
): Promise<UploadRejected> {
  await ctx.storage.delete(storageId);
  return { code: "INVALID_ATTACHMENT", message: rejectionReason };
}

export const getStorageMetadata = internalQuery({
  args: { storageId: v.id("_storage") },
  returns: v.union(
    v.null(),
    v.object({
      size: v.number(),
      contentType: v.optional(v.string()),
      sha256: v.string(),
    }),
  ),
  handler: async (ctx, { storageId }) => {
    const storageMetadata = await ctx.db.system.get("_storage", storageId);
    if (!storageMetadata) return null;
    const { size, contentType, sha256 } = storageMetadata;
    return { size, contentType, sha256 };
  },
});

/**
 * Saves an upload registerUpload checked: adds it to the Agent's files
 * table, and records that the user uploaded it. Returns its file ID and URL.
 */
export const saveUpload = internalMutation({
  args: {
    storageId: v.id("_storage"),
    filename: v.string(),
    mediaType: v.string(),
    sha256: v.string(),
  },
  returns: vRegisteredUpload,
  handler: async (
    ctx,
    { storageId: uploadedStorageId, filename, mediaType, sha256 },
  ) => {
    const user = await requireUser(ctx);

    // The Agent reuses its row for a file with the same hash and name. That
    // row keeps its own storage object, so this upload isn't needed.
    const agentFile = await ctx.runMutation(components.agent.files.addFile, {
      storageId: uploadedStorageId,
      hash: sha256,
      filename,
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

/** How long an upload can go unsent before cleanUpUnsentUploads deletes it. */
const UNSENT_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** How many attachments rows one cleanup transaction checks. */
const CLEANUP_BATCH_SIZE = 100;

/**
 * Deletes uploads that were never sent: files no message references, and
 * that nothing has touched for `maxAgeMs` (24 hours by default). For each
 * file it deletes the Agent's row, the storage object (the Agent's delete
 * leaves it), and the file's attachments rows.
 *
 * Deleting a thread drops its prompts' references to their files, which
 * touches the files. The first run `maxAgeMs` or more later deletes them.
 *
 * Runs daily (convex/crons.ts). To test it by hand, pass a shorter
 * `maxAgeMs`. The Agent's getFilesToDelete can't be used here, since its 24
 * hours are fixed.
 */
export const cleanUpUnsentUploads = internalMutation({
  args: { maxAgeMs: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { maxAgeMs = UNSENT_UPLOAD_MAX_AGE_MS }) => {
    await cleanUpUploadsBatch(ctx, Date.now() - maxAgeMs, null);
    return null;
  },
});

/** Checks the next batch for cleanUpUnsentUploads, with the same cutoff. */
export const continueUploadCleanUp = internalMutation({
  args: { cutoff: v.number(), cursor: v.string() },
  returns: v.null(),
  handler: async (ctx, { cutoff, cursor }) => {
    await cleanUpUploadsBatch(ctx, cutoff, cursor);
    return null;
  },
});

/**
 * Deletes the unsent uploads among one batch of attachments rows, then
 * schedules the next batch. `cutoff` is the latest last-touched time a file
 * can have and still be deleted.
 */
async function cleanUpUploadsBatch(
  ctx: MutationCtx,
  cutoff: number,
  cursor: string | null,
) {
  // Registering a file touches it, so a file untouched since the cutoff only
  // has rows created before it.
  const { page, isDone, continueCursor } = await ctx.db
    .query("attachments")
    .withIndex("by_creation_time", (q) => q.lte("_creationTime", cutoff))
    .paginate({ numItems: CLEANUP_BATCH_SIZE, cursor });

  const storageIds = new Map(page.map((row) => [row.fileId, row.storageId]));
  for (const [fileId, storageId] of storageIds) {
    const agentFile = await ctx.runQuery(components.agent.files.get, {
      fileId,
    });
    if (
      !agentFile ||
      agentFile.refcount > 0 ||
      agentFile.lastTouchedAt > cutoff
    ) {
      continue;
    }
    // This transaction just saw the file unreferenced, so `force` only skips
    // the Agent's own 24-hour check, which a shorter maxAgeMs needs.
    await ctx.runMutation(components.agent.files.deleteFiles, {
      fileIds: [fileId],
      force: true,
    });
    if (await ctx.db.system.get("_storage", storageId)) {
      await ctx.storage.delete(storageId);
    }
    const rows = ctx.db
      .query("attachments")
      .withIndex("by_fileId", (q) => q.eq("fileId", fileId));
    for await (const row of rows) {
      await ctx.db.delete("attachments", row._id);
    }
  }

  if (!isDone) {
    await ctx.scheduler.runAfter(0, internal.attachments.continueUploadCleanUp, {
      cutoff,
      cursor: continueCursor,
    });
  }
}

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
      const agentFile =
        userAttachment &&
        (await ctx.runQuery(components.agent.files.get, { fileId }));
      const fileUrl =
        agentFile && (await ctx.storage.getUrl(userAttachment.storageId));
      if (!agentFile || !fileUrl) return null;

      const mediaType = agentFile.mediaType ?? "";
      if (!acceptedMediaTypes.includes(mediaType)) {
        throw new ConvexError({
          code: "UNSUPPORTED_ATTACHMENT",
          message: "This model can't read this kind of file.",
        });
      }
      const filename = agentFile.filename ?? UNNAMED_FILE;
      const part: ImagePart | FilePart =
        getAttachmentKind(mediaType) === "image"
          ? { type: "image", image: new URL(fileUrl), mediaType }
          : { type: "file", data: new URL(fileUrl), mediaType, filename };
      return { fileId, filename, part };
    }),
  );
  const attachments = loadedAttachments.filter(
    (attachment) => attachment !== null,
  );
  if (attachments.length < loadedAttachments.length) {
    const notFound: AttachmentNotFound = {
      code: "NOT_FOUND",
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
