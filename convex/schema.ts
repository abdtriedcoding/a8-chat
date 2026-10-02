import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // One row for each reply the user stopped (stopReply in convex/chat.ts).
  // The Agent gives a prompt and its reply the same `order`, so `order`
  // identifies the turn.
  stoppedReplies: defineTable({
    threadId: v.string(),
    order: v.number(),
    // False if the user pressed Stop before seeing any of the reply. The
    // reply is then hidden, even if some of its text had been saved.
    keepText: v.boolean(),
  }).index("by_threadId_and_order", ["threadId", "order"]),
});
