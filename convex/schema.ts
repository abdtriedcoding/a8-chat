import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** A connection's state. A connection that stops working needs reconnecting. */
export const vConnectionStatus = v.union(
  v.literal("connected"),
  v.literal("needs_reconnect"),
);

/** The authorization server a connector sign-in started with. */
export const vAuthorizationServer = v.object({
  issuer: v.optional(v.string()),
  authorizationServerUrl: v.string(),
  tokenEndpoint: v.string(),
});

/** The OAuth client a8 registered for a connector. */
export const vConnectorClient = v.object({
  connectorId: v.string(),
  clientId: v.string(),
  encryptedClientSecret: v.optional(v.string()),
  clientIdIssuedAt: v.optional(v.number()),
  // Seconds since the epoch (RFC 7591). 0 means the secret never expires.
  clientSecretExpiresAt: v.optional(v.number()),
  issuer: v.optional(v.string()),
  authorizationServerUrl: v.optional(v.string()),
  tokenEndpoint: v.optional(v.string()),
});

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
  // One row for each thread that defers connector tools (ADR 0006). A reply
  // adds it the first time the user's connector tools pass the tool budget
  // (lib/toolLoading.ts), and the thread defers from then on, so its tool
  // list doesn't flip back and forth.
  deferredToolThreads: defineTable({
    threadId: v.string(),
  }).index("by_threadId", ["threadId"]),
  // Who uploaded each file in the Agent's files table (convex/attachments.ts).
  // A Send only takes files the user has a row for here. Users who upload the
  // same file share its Agent row, so a file can have a row per user.
  attachments: defineTable({
    userId: v.string(),
    fileId: v.string(),
    storageId: v.id("_storage"),
  })
    .index("by_userId_and_fileId", ["userId", "fileId"])
    .index("by_fileId", ["fileId"])
    .index("by_storageId", ["storageId"]),
  // Who may register each storage upload (convex/attachments.ts).
  // generateUploadUrl adds a row with no `storageId`, and registerUpload sets
  // it when the user who got the URL claims the file. Nobody else can claim a
  // file with a row. cleanUpOrphanedStorage deletes old rows.
  uploadGrants: defineTable({
    userId: v.string(),
    storageId: v.optional(v.id("_storage")),
  })
    .index("by_userId_and_storageId", ["userId", "storageId"])
    .index("by_storageId", ["storageId"]),
  // One user's signed-in link to a connector (convex/connectors.ts). At most
  // one row per user and connector. lib/encryption.ts encrypts the tokens,
  // and no public function returns them.
  connections: defineTable({
    userId: v.string(),
    connectorId: v.string(),
    status: vConnectionStatus,
    encryptedAccessToken: v.string(),
    encryptedRefreshToken: v.optional(v.string()),
    // When the access token expires, in ms since the epoch. Unset if the
    // vendor didn't say.
    tokenExpiresAt: v.optional(v.number()),
    // Bumped on every token change, for the refresh lease (ADR 0003).
    tokenVersion: v.number(),
    // Set while a reply holds the refresh lease (claimRefresh), and until
    // when. Other replies wait for it instead of refreshing too.
    refreshLeaseExpiresAt: v.optional(v.number()),
    // Names the signed-in account, like the Notion workspace.
    accountLabel: v.optional(v.string()),
    // Moved to connectionToolLists. migrateToolLists (convex/toolLists.ts)
    // moves each row's list and unsets these, and then they go.
    toolList: v.optional(v.string()),
    toolListFetchedAt: v.optional(v.number()),
    toolListRefreshRequestedAt: v.optional(v.number()),
    connectedAt: v.number(),
  }).index("by_userId_and_connectorId", ["userId", "connectorId"]),
  // The tools a8 stores for one connection (convex/toolLists.ts), apart from
  // the connection so a token refresh doesn't rewrite them. One row per
  // connection. saveConnection writes it, a reply refreshes it when it's a
  // day old, and deleting the connection deletes it.
  connectionToolLists: defineTable({
    connectionId: v.id("connections"),
    // The allowlisted tools, as JSON (lib/connectorToolList.ts).
    tools: v.string(),
    // About how many tokens the tools' definitions take, counted when they
    // were fetched, so a reply doesn't measure them.
    estimatedTokens: v.number(),
    fetchedAt: v.number(),
    // When a reply last scheduled refreshToolList. Until the cooldown ends,
    // requestToolListRefresh schedules no other refresh.
    refreshRequestedAt: v.optional(v.number()),
  }).index("by_connectionId", ["connectionId"]),
  // One row per sign-in in progress (convex/connectors.ts). finishConnect
  // deletes the row. cleanUpExpiredConnects deletes the ones nobody finished.
  pendingConnects: defineTable({
    state: v.string(),
    codeVerifier: v.string(),
    userId: v.string(),
    connectorId: v.string(),
    // finishConnect checks that the code exchange goes to this server.
    authorizationServer: vAuthorizationServer,
    expiresAt: v.number(),
  })
    .index("by_state", ["state"])
    .index("by_expiresAt", ["expiresAt"])
    .index("by_userId", ["userId"]),
  // The OAuth client a8 registered with a connector's authorization server.
  // One row per connector per deployment, shared by every user. Notion
  // orphans earlier grants when a client registers again, so a8 only
  // registers again after the vendor rejects this client or its secret
  // expires.
  connectorClients: defineTable(vConnectorClient).index("by_connectorId", [
    "connectorId",
  ]),
});
