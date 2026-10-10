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
    // The MCP server's tools/list result, as JSON. Stored as a string
    // because JSON Schema keys like "$schema" aren't valid Convex field names.
    toolList: v.string(),
    toolListFetchedAt: v.number(),
    connectedAt: v.number(),
  }).index("by_userId_and_connectorId", ["userId", "connectorId"]),
  // One row per sign-in in progress (convex/connectors.ts). finishConnect
  // deletes the row. cleanUpExpiredConnects deletes the ones nobody finished.
  pendingConnects: defineTable({
    state: v.string(),
    codeVerifier: v.string(),
    userId: v.string(),
    connectorId: v.string(),
    // finishConnect checks that the code exchange goes to this server.
    authorizationServer: vAuthorizationServer,
    // No longer written. Rows saved before the callback stopped storing the
    // code may still have these. Remove them once those rows have expired.
    code: v.optional(v.string()),
    callbackIssuer: v.optional(v.string()),
    expiresAt: v.number(),
  })
    .index("by_state", ["state"])
    .index("by_expiresAt", ["expiresAt"])
    .index("by_userId", ["userId"]),
  // The OAuth client a8 registered with a connector's authorization server.
  // One row per connector per deployment, shared by every user. Notion
  // orphans earlier grants when a client registers again, so a8 only
  // registers again after the vendor rejects this client.
  connectorClients: defineTable(vConnectorClient).index("by_connectorId", [
    "connectorId",
  ]),
});
