import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

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
