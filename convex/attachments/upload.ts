// See the docs at https://docs.convex.dev/agents/files
import { v, type Infer } from "convex/values";
import { appError, ERROR_CODES } from "../lib/errors";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  action,
  internalMutation,
  mutation,
  query,
  type ActionCtx,
} from "../_generated/server";
import { chatModel } from "../agents/chat";
import { requireIdentity, requireUser } from "../lib/guards";
import { limitUploadRegistration, limitUploadUrl } from "../rateLimits";
import {
  cleanFilename,
  getAcceptedMediaTypes,
  getAttachmentRejectionReason,
  getOversizeReason,
  readMediaType,
} from "../lib/attachments";

// Attaching a file takes three steps. The browser gets an upload URL
// (generateUploadUrl), uploads the file straight to Convex storage, then
// registers it (registerUpload). It goes straight to storage because HTTP
// actions cap request bodies at 20 MB.

const vRegisteredUpload = v.object({ fileId: v.string(), fileUrl: v.string() });

/** Why registerUpload refused a file. It returns this instead of throwing. */
const vUploadRejected = v.object({
  code: v.literal(ERROR_CODES.INVALID_ATTACHMENT),
  message: v.string(),
});

/** What claimUpload reads from the stored file's metadata. */
const vClaimedUpload = v.object({ size: v.number(), sha256: v.string() });

type RegisteredUpload = Infer<typeof vRegisteredUpload>;
type UploadRejected = Infer<typeof vUploadRejected>;
type ClaimedUpload = Infer<typeof vClaimedUpload>;

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

/** How long an upload grant can wait before registerUpload can't spend it. */
export const UPLOAD_GRANT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Gives the browser a URL to upload one file to. It records an upload grant
 * for the user, which registerUpload spends to claim the file. Convex can't
 * say who uploaded a file, so a grant, and the claim that follows it, are how
 * a file gets tied to its uploader.
 */
export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if (!(await limitUploadUrl(ctx, user._id))) {
      throw appError(
        ERROR_CODES.RATE_LIMITED,
        "Too many uploads. Try again later.",
      );
    }
    await ctx.db.insert("uploadGrants", { userId: user._id });
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Ties an uploaded file to the user registering it, and returns the file's
 * size and hash, or refuses. Actions can't read storage metadata, so it
 * returns them for registerUpload. A user can claim a file if:
 * - nobody has claimed it, and the user has a grant from the last 24 hours
 *   that's older than the file, which the claim then spends, or
 * - the user already claimed it, as on a retry.
 *
 * It returns a refusal, and registerUpload deletes nothing, when the file
 * doesn't exist, someone else claimed it, or the user has no grant for it.
 * A refusal looks the same for each, so it doesn't reveal that a file
 * exists. It also refuses a user over their limit.
 *
 * A user who learns another user's storage ID in the seconds between that
 * user's upload and registration could still claim it first. Storage IDs
 * are random and only the uploader's browser sees one, so a8 accepts that.
 */
export const claimUpload = internalMutation({
  args: { storageId: v.id("_storage") },
  returns: v.union(vClaimedUpload, vUploadRejected),
  handler: async (
    ctx,
    { storageId },
  ): Promise<ClaimedUpload | UploadRejected> => {
    const user = await requireUser(ctx);
    if (!(await limitUploadRegistration(ctx, user._id))) {
      return {
        code: ERROR_CODES.INVALID_ATTACHMENT,
        message: "Too many uploads. Try again later.",
      };
    }
    const notFound: UploadRejected = {
      code: ERROR_CODES.INVALID_ATTACHMENT,
      message: "Upload not found.",
    };
    const storedFile = await ctx.db.system.get("_storage", storageId);
    if (!storedFile) return notFound;
    const claimedUpload = { size: storedFile.size, sha256: storedFile.sha256 };

    const claim = await ctx.db
      .query("uploadGrants")
      .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
      .first();
    if (claim) {
      return claim.userId === user._id ? claimedUpload : notFound;
    }

    const grant = await ctx.db
      .query("uploadGrants")
      .withIndex("by_userId_and_storageId", (q) =>
        q
          .eq("userId", user._id)
          .eq("storageId", undefined)
          .gte("_creationTime", Date.now() - UPLOAD_GRANT_MAX_AGE_MS)
          .lte("_creationTime", storedFile._creationTime),
      )
      .first();
    if (!grant) return notFound;
    await ctx.db.patch("uploadGrants", grant._id, { storageId });
    return claimedUpload;
  },
});

/**
 * Registers a file the user uploaded, so a Send can attach it. The browser's
 * checks can be skipped, so it checks the file again: its size, and the type
 * its first bytes show, which is the type it's saved with. The browser sets
 * the type the upload declared, so registerUpload ignores it.
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
    await requireIdentity(ctx);
    // Nothing below deletes a file until the user has claimed it.
    const claimedUpload: ClaimedUpload | UploadRejected = await ctx.runMutation(
      internal.attachments.upload.claimUpload,
      { storageId },
    );
    if ("code" in claimedUpload) return claimedUpload;
    const safeFilename = cleanFilename(filename);
    const acceptedMediaTypes = getAcceptedMediaTypes(chatModel.provider);

    // registerUpload refuses a file too big for every type before reading it.
    const oversizeReason = getOversizeReason(
      { name: safeFilename, size: claimedUpload.size },
      acceptedMediaTypes,
    );
    if (oversizeReason) {
      return await rejectUpload(ctx, storageId, oversizeReason);
    }

    // An empty type, for bytes that match no type a8 takes, is refused here.
    const storedFile = await ctx.storage.get(storageId);
    const mediaType = storedFile ? await readMediaType(storedFile) : "";
    const rejectionReason = getAttachmentRejectionReason(
      { name: safeFilename, type: mediaType, size: claimedUpload.size },
      acceptedMediaTypes,
    );
    if (rejectionReason) {
      return await rejectUpload(ctx, storageId, rejectionReason);
    }

    return await ctx.runMutation(internal.attachments.upload.saveUpload, {
      storageId,
      filename: safeFilename,
      mediaType,
      sha256: claimedUpload.sha256,
    });
  },
});

/** Deletes a refused upload from storage, and returns the refusal. */
async function rejectUpload(
  ctx: ActionCtx,
  storageId: Id<"_storage">,
  rejectionReason: string,
): Promise<UploadRejected> {
  await ctx.storage.delete(storageId);
  return { code: ERROR_CODES.INVALID_ATTACHMENT, message: rejectionReason };
}

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
      throw appError(ERROR_CODES.NOT_FOUND, "Upload not found.");
    }
    return { fileId: agentFile.fileId, fileUrl };
  },
});
