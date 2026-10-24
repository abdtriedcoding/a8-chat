import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { isSharedFilePart } from "./lib/sharedFiles";

/** The fields a8 stopped storing, by table. */
const UNUSED_FIELDS = {
  pendingActions: ["count", "since"],
  autoApproveThreads: ["userId"],
  threadModels: ["userId"],
  sharedSnapshots: ["userId"],
  oauthClientRegistrations: ["clientIdIssuedAt"],
} as const;

type Table = keyof typeof UNUSED_FIELDS;

const TABLES = Object.keys(UNUSED_FIELDS) as Table[];

const BATCH_SIZE = 200;

/**
 * Unsets the fields a8 stopped storing, a batch at a time, then schedules
 * the next batch. Run it once on each deployment:
 *
 *   npx convex run migrations:dropUnusedFields
 *
 * Once it's done everywhere, delete the fields from schema.ts and this file.
 */
export const dropUnusedFields = internalMutation({
  args: {
    table: v.optional(v.string()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const table = (args.table ?? TABLES[0]) as Table;
    const fields = UNUSED_FIELDS[table];
    const { page, isDone, continueCursor } = await ctx.db
      .query(table)
      .paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE });
    const unset = Object.fromEntries(fields.map((field) => [field, undefined]));
    for (const doc of page) {
      if (fields.some((field) => field in doc)) {
        await ctx.db.patch(table, doc._id, unset);
      }
    }
    const next = isDone ? TABLES[TABLES.indexOf(table) + 1] : table;
    if (next) {
      await ctx.scheduler.runAfter(0, internal.migrations.dropUnusedFields, {
        table: next,
        cursor: isDone ? null : continueCursor,
      });
    } else {
      console.log("Unused fields dropped.");
    }
    return null;
  },
});

const SHARED_MESSAGES_BATCH_SIZE = 20;

/**
 * Swaps the storage URL on each shared snapshot's file part for its file
 * ID, so the shared page loads the file through its link
 * (sharedSnapshots.serveSharedFile). It looks for each URL among the
 * storage URLs of the files the snapshot's version holds, and drops a part
 * it can't find. Run it once on each deployment:
 *
 *   npx convex run migrations:replaceSharedFileUrlsWithIds
 *
 * Once it's done everywhere, make the part's `fileId` required, delete its
 * `url` (lib/sharedMessages.ts), and delete this.
 */
export const replaceSharedFileUrlsWithIds = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { page, isDone, continueCursor } = await ctx.db
      .query("sharedSnapshotMessages")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: SHARED_MESSAGES_BATCH_SIZE,
      });
    // The file IDs by storage URL found so far, per snapshot version.
    const found = new Map<string, Map<string, string>>();
    for (const row of page) {
      const { message } = row;
      const urls = message.parts.flatMap((part) =>
        isSharedFilePart(part) && part.url !== undefined ? [part.url] : [],
      );
      if (urls.length === 0) continue;
      const key = `${row.snapshotId}:${row.version}`;
      const fileIdsByUrl = found.get(key) ?? new Map<string, string>();
      found.set(key, fileIdsByUrl);
      if (urls.some((url) => !fileIdsByUrl.has(url))) {
        // Reads the version's files only until it has found every URL.
        const files = ctx.db
          .query("sharedSnapshotFiles")
          .withIndex("by_snapshotId_and_version_and_fileId", (q) =>
            q.eq("snapshotId", row.snapshotId).eq("version", row.version),
          );
        for await (const { fileId } of files) {
          if ([...fileIdsByUrl.values()].includes(fileId)) continue;
          const file = await ctx.runQuery(components.agent.files.get, {
            fileId,
          });
          const url =
            file &&
            (await ctx.storage.getUrl(file.storageId as Id<"_storage">));
          if (url) fileIdsByUrl.set(url, fileId);
          if (urls.every((url) => fileIdsByUrl.has(url))) break;
        }
      }
      const parts = message.parts.flatMap((part) => {
        if (!isSharedFilePart(part) || part.url === undefined) return [part];
        const { url, ...rest } = part;
        const fileId = fileIdsByUrl.get(url);
        return fileId === undefined ? [] : [{ ...rest, fileId }];
      });
      const dropped = message.parts.length - parts.length;
      if (dropped > 0) {
        console.warn(`Dropped ${dropped} unmatched file part(s) of ${row._id}.`);
      }
      await ctx.db.patch("sharedSnapshotMessages", row._id, {
        message: { ...message, parts },
      });
    }
    if (isDone) {
      console.log("Shared file URLs replaced with file IDs.");
    } else {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.replaceSharedFileUrlsWithIds,
        { cursor: continueCursor },
      );
    }
    return null;
  },
});
