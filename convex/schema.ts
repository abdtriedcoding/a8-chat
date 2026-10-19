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

/** The OAuth client registration a8 made for a connector. */
export const vOAuthClientRegistration = v.object({
  connectorId: v.string(),
  clientId: v.string(),
  encryptedClientSecret: v.optional(v.string()),
  clientIdIssuedAt: v.optional(v.number()),
  // Seconds since the epoch (RFC 7591). 0 means the secret never expires.
  clientSecretExpiresAt: v.optional(v.number()),
  // The authorization server it registered with. Unset on rows from before
  // a8 stored it.
  issuer: vAuthorizationServer.fields.issuer,
  authorizationServerUrl: v.optional(
    vAuthorizationServer.fields.authorizationServerUrl,
  ),
  tokenEndpoint: v.optional(vAuthorizationServer.fields.tokenEndpoint),
});

export default defineSchema({
  // One row for each reply the user stopped (stopReply in convex/chat/stop.ts).
  // The Agent gives a prompt and its reply the same `order`, so `order`
  // identifies the turn.
  stoppedReplies: defineTable({
    threadId: v.string(),
    order: v.number(),
  }).index("by_threadId_and_order", ["threadId", "order"]),
  // One row for each thread that defers connector tools (ADR 0006). A reply
  // adds it the first time the user's connector tools pass the tool budget
  // (defersTools in convex/lib/replyTools.ts), and the thread defers from
  // then on, so its tool list doesn't flip back and forth.
  deferredToolThreads: defineTable({
    threadId: v.string(),
  }).index("by_threadId", ["threadId"]),
  // One row per pinned thread (setPinned in convex/threads.ts). Its creation
  // time is when the user pinned the thread. Archiving or deleting the thread
  // deletes the row.
  threadPins: defineTable({
    userId: v.string(),
    threadId: v.string(),
  })
    .index("by_userId", ["userId"])
    .index("by_threadId", ["threadId"]),
  // A thread's queued prompts (convex/chat/queue.ts), oldest first by
  // creation time. sendMessage adds one while a reply is running or the
  // queue isn't paused, and startNextPrompt (convex/chat/send.ts) removes
  // it when it starts. sendMessage checks the text and counts the Send
  // before it adds the row.
  queuedPrompts: defineTable({
    threadId: v.string(),
    userId: v.string(),
    prompt: v.string(),
    attachmentFileIds: v.array(v.string()),
    // The browser's time zone when the prompt was queued, unchecked.
    timeZone: v.optional(v.string()),
  }).index("by_threadId", ["threadId"]),
  // One row per file a queued prompt attaches, so cleanUpUnsentUploads can
  // look a file up and keep it while the prompt waits. An array field can't
  // be indexed.
  queuedPromptFiles: defineTable({
    queuedPromptId: v.id("queuedPrompts"),
    fileId: v.string(),
  })
    .index("by_queuedPromptId", ["queuedPromptId"])
    .index("by_fileId", ["fileId"]),
  // One row per paused queue. Stop and a failed reply add it, Resume
  // deletes it, and so does deleting the last queued prompt, since an empty
  // queue is never paused.
  pausedQueues: defineTable({
    threadId: v.string(),
  }).index("by_threadId", ["threadId"]),
  // Who uploaded each file in the Agent's files table
  // (convex/attachments/upload.ts). A Send only takes files the user has a row
  // for here. Users who upload the same file share its Agent row, so a file
  // can have a row per user.
  attachments: defineTable({
    userId: v.string(),
    fileId: v.string(),
    storageId: v.id("_storage"),
  })
    .index("by_userId_and_fileId", ["userId", "fileId"])
    .index("by_fileId", ["fileId"])
    .index("by_storageId", ["storageId"]),
  // Who may register each storage upload (convex/attachments/upload.ts).
  // generateUploadUrl adds a row with no `storageId`, and registerUpload sets
  // it when the user who got the URL claims the file. Nobody else can claim a
  // file with a row. cleanUpUploadGrants deletes old rows.
  uploadGrants: defineTable({
    userId: v.string(),
    storageId: v.optional(v.id("_storage")),
  })
    .index("by_userId_and_storageId", ["userId", "storageId"])
    .index("by_storageId", ["storageId"]),
  // One user's link to a connector (convex/connectors.ts). At most one row
  // per user and connector. lib/encryption.ts encrypts the tokens, and no
  // public function returns them.
  connections: defineTable({
    userId: v.string(),
    connectorId: v.string(),
    status: vConnectionStatus,
    // Unset for a connector with no sign-in, whose server needs no token.
    encryptedAccessToken: v.optional(v.string()),
    encryptedRefreshToken: v.optional(v.string()),
    // When the access token expires, in ms since the epoch. Unset if the
    // vendor didn't say.
    tokenExpiresAt: v.optional(v.number()),
    // The `resource` sign-in sent with the code exchange (RFC 8707). A
    // refresh sends it again (ADR 0010). Unset on rows from before a8
    // stored it, and then a refresh sends none.
    resource: v.optional(v.string()),
    // The scopes the vendor granted, from the token response's `scope`.
    // Unset when the vendor didn't say, which means it granted what sign-in
    // asked for (RFC 6749 section 5.1).
    grantedScopes: v.optional(v.array(v.string())),
    // Bumped on every token change, for the refresh lease (ADR 0003).
    tokenVersion: v.number(),
    // Set while a reply holds the refresh lease (claimRefresh), and until
    // when. Other replies wait for it instead of refreshing too.
    refreshLeaseExpiresAt: v.optional(v.number()),
    // Names the signed-in account, like the Notion workspace.
    accountLabel: v.optional(v.string()),
    connectedAt: v.number(),
  }).index("by_userId_and_connectorId", ["userId", "connectorId"]),
  // The tools a8 stores for one connection (convex/toolLists.ts), apart from
  // the connection so a token refresh doesn't rewrite them. One row per
  // connection. saveConnection writes it, a reply refreshes it when it's a
  // day old, and deleting the connection deletes it.
  connectionToolLists: defineTable({
    connectionId: v.id("connections"),
    // The allowlisted tools from every server of the connection's
    // connector, as JSON, each with its server's key
    // (lib/connectorToolList.ts).
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
  // OAuth client registrations: the client a8 registered with a connector's
  // authorization server (convex/signIns.ts). One row per connector per
  // deployment, shared by every user. Notion orphans earlier grants when a
  // client registers again, so a8 only registers again after the vendor
  // rejects this client or its secret expires.
  oauthClientRegistrations: defineTable(vOAuthClientRegistration).index(
    "by_connectorId",
    ["connectorId"],
  ),
});
