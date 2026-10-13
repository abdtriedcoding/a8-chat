// See the docs at https://docs.convex.dev/agents/files
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { UPLOAD_GRANT_MAX_AGE_MS } from "./upload";

/**
 * How long an upload can go unregistered before cleanUpOrphanedStorage
 * deletes it. Matches the 24 hours the Agent's getFilesToDelete waits, which
 * the Agent doesn't export.
 */
const UNSENT_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** How many Agent files one cleanup transaction deletes. */
const CLEANUP_BATCH_SIZE = 100;
/**
 * How many of one file's attachments rows a cleanup transaction deletes. A
 * transaction can delete up to CLEANUP_BATCH_SIZE files, so this keeps its
 * writes to about 1,300.
 */
const ROW_DELETE_BATCH_SIZE = 10;

/**
 * Deletes uploads that were never sent: files no message references, and
 * that nothing has touched for 24 hours. It pages the Agent's
 * getFilesToDelete, so it reads only unused files. For each file it deletes
 * the Agent's row, the storage object (the Agent's delete leaves it), and
 * the file's attachments rows.
 *
 * It deletes every unused Agent file, with or without an attachments row.
 * Today saveUpload (convex/attachments/upload.ts) is the only code that
 * adds Agent files. If the Agent ever stores inline bytes as files (see
 * cleanUpOrphanedStorage), this job deletes those once their messages are
 * gone too.
 *
 * Deleting a thread drops its prompts' references to their files, which
 * touches the files. The first run 24 hours or more later deletes them.
 *
 * Runs daily (convex/crons.ts). To test it by hand, set the Agent file row's
 * `lastTouchedAt` to over 24 hours ago.
 */
export const cleanUpUnsentUploads = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await cleanUpUploadsBatch(ctx, null);
    return null;
  },
});

/** Deletes the next batch for cleanUpUnsentUploads. */
export const continueUploadCleanUp = internalMutation({
  args: { cursor: v.string() },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    await cleanUpUploadsBatch(ctx, cursor);
    return null;
  },
});

/** Deletes one batch of unsent uploads, then schedules the next batch. */
async function cleanUpUploadsBatch(ctx: MutationCtx, cursor: string | null) {
  const { page, isDone, continueCursor } = await ctx.runQuery(
    components.agent.files.getFilesToDelete,
    { paginationOpts: { numItems: CLEANUP_BATCH_SIZE, cursor } },
  );

  // deleteFiles checks the refcount and the 24 hours again, and returns the
  // files it deleted. Only those lose their storage object and rows.
  const deletedFileIds = new Set(
    await ctx.runMutation(components.agent.files.deleteFiles, {
      fileIds: page.map((file) => file._id),
    }),
  );
  for (const file of page) {
    if (!deletedFileIds.has(file._id)) continue;
    const storageId = file.storageId as Id<"_storage">;
    if (await ctx.db.system.get("_storage", storageId)) {
      await ctx.storage.delete(storageId);
    }
    await deleteAttachmentRows(ctx, file._id);
  }

  if (!isDone) {
    await ctx.scheduler.runAfter(
      0,
      internal.attachments.cleanup.continueUploadCleanUp,
      { cursor: continueCursor },
    );
  }
}

/** How many storage files one orphan cleanup transaction checks. */
const ORPHAN_BATCH_SIZE = 100;
/**
 * How far back cleanUpOrphanedStorage looks. Each run reads every storage
 * file created from this far back up to UNSENT_UPLOAD_MAX_AGE_MS ago, a
 * 2-day window. It runs daily, so two runs read each file, and one can be
 * missed. A file no run reads stays in storage.
 */
const ORPHAN_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;
/**
 * How long an upload grant row stays. Twice UPLOAD_GRANT_MAX_AGE_MS, so a
 * claim row outlives every grant that could still claim its file.
 */
const UPLOAD_GRANT_RETENTION_MS = 2 * UPLOAD_GRANT_MAX_AGE_MS;
/** How many upload grant rows one cleanup transaction deletes. */
const GRANT_DELETE_BATCH_SIZE = 500;

/**
 * Deletes upload grant rows older than `maxAgeMs` (48 hours by default). A
 * full batch schedules the next one with the same cutoff, until a batch
 * comes back short.
 *
 * Runs daily (convex/crons.ts). To test it by hand, pass a shorter
 * `maxAgeMs`.
 */
export const cleanUpUploadGrants = internalMutation({
  args: { maxAgeMs: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { maxAgeMs = UPLOAD_GRANT_RETENTION_MS }) => {
    await cleanUpGrantsBatch(ctx, Date.now() - maxAgeMs);
    return null;
  },
});

/** Deletes the next batch for cleanUpUploadGrants, with the same cutoff. */
export const continueGrantCleanUp = internalMutation({
  args: { cutoff: v.number() },
  returns: v.null(),
  handler: async (ctx, { cutoff }) => {
    await cleanUpGrantsBatch(ctx, cutoff);
    return null;
  },
});

/**
 * Deletes one batch of upload grant rows created before `cutoff`, then
 * schedules the next batch if this one was full.
 */
async function cleanUpGrantsBatch(ctx: MutationCtx, cutoff: number) {
  const oldGrants = await ctx.db
    .query("uploadGrants")
    .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
    .take(GRANT_DELETE_BATCH_SIZE);
  for (const grant of oldGrants) {
    await ctx.db.delete("uploadGrants", grant._id);
  }
  if (oldGrants.length === GRANT_DELETE_BATCH_SIZE) {
    await ctx.scheduler.runAfter(
      0,
      internal.attachments.cleanup.continueGrantCleanUp,
      { cutoff },
    );
  }
}

/**
 * Deletes storage files nobody registered: uploads older than 24 hours with
 * no attachments row. registerUpload fails for a file this old unless its
 * grant is still valid, and saveUpload writes the attachments row in the
 * transaction that adds the file to the Agent, so a file with no row isn't
 * used by a message. Files with a row are never deleted here, whether or
 * not a message uses them. cleanUpUnsentUploads deletes unused Agent files.
 *
 * The Agent also stores a file, with no row, when a message holds inline
 * bytes over 64 KB. a8's prompts hold file URLs (loadPromptAttachments in
 * convex/attachments/load.ts), so that doesn't happen. A change that saves
 * inline bytes must keep this job from deleting those files.
 *
 * Runs daily (convex/crons.ts).
 */
export const cleanUpOrphanedStorage = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    await cleanUpOrphansBatch(
      ctx,
      now - UNSENT_UPLOAD_MAX_AGE_MS,
      now - ORPHAN_LOOKBACK_MS,
      null,
    );
    return null;
  },
});

/** Checks the next batch for cleanUpOrphanedStorage, with the same window. */
export const continueOrphanCleanUp = internalMutation({
  args: { cutoff: v.number(), since: v.number(), cursor: v.string() },
  returns: v.null(),
  handler: async (ctx, { cutoff, since, cursor }) => {
    await cleanUpOrphansBatch(ctx, cutoff, since, cursor);
    return null;
  },
});

/**
 * Deletes the orphans among one batch of storage files created from `since`
 * to `cutoff`, then schedules the next batch.
 */
async function cleanUpOrphansBatch(
  ctx: MutationCtx,
  cutoff: number,
  since: number,
  cursor: string | null,
) {
  const { page, isDone, continueCursor } = await ctx.db.system
    .query("_storage")
    .withIndex("by_creation_time", (q) =>
      q.gte("_creationTime", since).lt("_creationTime", cutoff),
    )
    .paginate({ numItems: ORPHAN_BATCH_SIZE, cursor });
  for (const storedFile of page) {
    const attachment = await ctx.db
      .query("attachments")
      .withIndex("by_storageId", (q) => q.eq("storageId", storedFile._id))
      .first();
    if (!attachment) await ctx.storage.delete(storedFile._id);
  }
  if (!isDone) {
    await ctx.scheduler.runAfter(
      0,
      internal.attachments.cleanup.continueOrphanCleanUp,
      { cutoff, since, cursor: continueCursor },
    );
  }
}

/** How many attachments rows, then grants, one account cleanup step handles. */
const PURGE_BATCH_SIZE = 50;

/**
 * Deletes a deleted user's uploads: their attachments rows and, where no
 * other user has a row for the same file, the Agent's file and its storage
 * object. Then their upload grants, and the storage objects they claimed
 * that nothing else uses. It schedules itself until nothing is left, and
 * takes the user ID, not the session, since the account is already gone.
 * Scheduled by purgeAccount (convex/auth.ts).
 *
 * `force` skips the Agent's refcount check. The user's threads are deleted
 * at the same time, so their prompts may still hold the file.
 */
export const purgeUserUploads = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("attachments")
      .withIndex("by_userId_and_fileId", (q) => q.eq("userId", userId))
      .take(PURGE_BATCH_SIZE);
    for (const row of rows) {
      await ctx.db.delete("attachments", row._id);
      const other = await ctx.db
        .query("attachments")
        .withIndex("by_fileId", (q) => q.eq("fileId", row.fileId))
        .first();
      // Another user who uploaded the same file shares the Agent's row.
      if (other) continue;
      await ctx.runMutation(components.agent.files.deleteFiles, {
        fileIds: [row.fileId],
        force: true,
      });
      if (await ctx.db.system.get("_storage", row.storageId)) {
        await ctx.storage.delete(row.storageId);
      }
    }

    const grants =
      rows.length < PURGE_BATCH_SIZE
        ? await ctx.db
            .query("uploadGrants")
            .withIndex("by_userId_and_storageId", (q) => q.eq("userId", userId))
            .take(PURGE_BATCH_SIZE)
        : [];
    for (const grant of grants) {
      await ctx.db.delete("uploadGrants", grant._id);
      const { storageId } = grant;
      if (!storageId) continue;
      const used = await ctx.db
        .query("attachments")
        .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
        .first();
      if (!used && (await ctx.db.system.get("_storage", storageId))) {
        await ctx.storage.delete(storageId);
      }
    }

    if (
      rows.length === PURGE_BATCH_SIZE ||
      grants.length === PURGE_BATCH_SIZE
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.attachments.cleanup.purgeUserUploads,
        { userId },
      );
    }
    return null;
  },
});

/** Deletes the next batch of a deleted file's attachments rows. */
export const continueAttachmentRowDeletion = internalMutation({
  args: { fileId: v.string() },
  returns: v.null(),
  handler: async (ctx, { fileId }) => {
    await deleteAttachmentRows(ctx, fileId);
    return null;
  },
});

/**
 * Deletes up to ROW_DELETE_BATCH_SIZE of a file's attachments rows, and
 * schedules the rest. A file has a row per user who uploaded it, so it can
 * have more rows than one transaction should delete. Call it after deleting
 * the file's Agent row. Until the rest are deleted, a Send refuses them.
 */
async function deleteAttachmentRows(ctx: MutationCtx, fileId: string) {
  const rows = await ctx.db
    .query("attachments")
    .withIndex("by_fileId", (q) => q.eq("fileId", fileId))
    .take(ROW_DELETE_BATCH_SIZE + 1);
  for (const row of rows.slice(0, ROW_DELETE_BATCH_SIZE)) {
    await ctx.db.delete("attachments", row._id);
  }
  if (rows.length > ROW_DELETE_BATCH_SIZE) {
    await ctx.scheduler.runAfter(
      0,
      internal.attachments.cleanup.continueAttachmentRowDeletion,
      { fileId },
    );
  }
}
