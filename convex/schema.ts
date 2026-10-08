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
  // Who uploaded each file in the Agent's files table (convex/attachments.ts).
  // A Send only takes files the user has a row for here. Users who upload the
  // same file share its Agent row, so a file can have a row per user.
  attachments: defineTable({
    userId: v.string(),
    fileId: v.string(),
    storageId: v.id("_storage"),
  })
    .index("by_userId_and_fileId", ["userId", "fileId"])
    .index("by_fileId", ["fileId"]),
  // One row per user per catalog connector (convex/connections.ts). Fields
  // named `sealed*` hold vault ciphertext (convex/lib/vault.ts) and never
  // leave the backend.
  connections: defineTable({
    userId: v.string(),
    // The catalog connector's handle (convex/connectors/registry.ts).
    connector: v.string(),
    handle: v.string(),
    serverUrl: v.string(),
    status: v.union(v.literal("connected"), v.literal("needsReconnect")),
    // The OAuth tokens as the MCP SDK saved them. Unset for a server that
    // needs no sign-in.
    sealedTokens: v.optional(v.string()),
    scopes: v.optional(v.string()),
    // When the access token expires, in milliseconds since the epoch.
    expiresAt: v.optional(v.number()),
    // The OAuth client a8 registered with the server, and where the SDK
    // found the server's authorization endpoints.
    sealedClient: v.optional(v.string()),
    discovery: v.optional(v.string()),
  }).index("by_userId_and_connector", ["userId", "connector"]),
  // A sign-in the user started but hasn't finished (convex/connections.ts).
  // The callback route finds it by `state` and adds the code the server
  // sent back. It expires after 10 minutes.
  signIns: defineTable({
    state: v.string(),
    userId: v.string(),
    connector: v.string(),
    // The page to go back to, like /apps.
    returnPath: v.string(),
    sealedCodeVerifier: v.string(),
    sealedClient: v.string(),
    discovery: v.optional(v.string()),
    // The authorization code, once the server has sent the user back.
    sealedCode: v.optional(v.string()),
    expiresAt: v.number(),
  }).index("by_state", ["state"]),
  // The tools each connection's server listed when it connected.
  tools: defineTable({
    connectionId: v.id("connections"),
    name: v.string(),
    description: v.optional(v.string()),
    // JSON. Schemas can hold keys like `$schema`, which Convex objects can't.
    inputSchema: v.string(),
    // A read runs at once. An action waits for the user's approval.
    kind: v.union(v.literal("read"), v.literal("action")),
    // Every tool is on until Stage 5's per-tool settings.
    enabled: v.boolean(),
  }).index("by_connectionId", ["connectionId"]),
});
