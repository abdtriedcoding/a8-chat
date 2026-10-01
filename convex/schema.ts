import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // One row per turn whose reply the user stopped (convex/lib/stop.ts). A
  // turn is the Agent's `order`: a prompt and its reply share it.
  stoppedReplies: defineTable({
    threadId: v.string(),
    order: v.number(),
    // False when the user stopped before seeing any of the reply's text,
    // which then goes too, even if some had already streamed.
    keepText: v.boolean(),
    // False until the reply runner is done with the turn. Only then can the
    // reply be regenerated, or the new reply would race the old runner.
    // Rows from before this field don't have it: their runners are long gone.
    settled: v.optional(v.boolean()),
  }).index("by_threadId_and_order", ["threadId", "order"]),
});
