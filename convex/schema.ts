import { defineSchema, defineTable } from "convex/server";
import { v, type Infer } from "convex/values";
import { vSchedule } from "./lib/schedule";
import { vSharedMessage } from "./lib/sharedMessages";

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

/** A paused one waits for the user. A done one is a one-off that ran. */
export const vScheduledPromptStatus = v.union(
  v.literal("active"),
  v.literal("paused"),
  v.literal("done"),
);

/** When a scheduled prompt last ran, and how that run went. */
export const vLastRun = v.object({
  at: v.number(),
  outcome: v.union(
    v.literal("finished"),
    v.literal("actionWaiting"),
    v.literal("failed"),
    v.literal("stopped"),
    v.literal("skipped"),
  ),
  // Why a failed run failed, such as the send limit's message.
  message: v.optional(v.string()),
});

/**
 * What a usage event paid for. A title's cost counts toward the day's spend
 * but not toward the user's credits.
 */
export const vUsageKind = v.union(
  v.literal("replyStep"),
  v.literal("webSearch"),
  v.literal("title"),
);

/** A credit ledger row's period and credits. Times are in ms. */
export const vCreditPeriod = v.object({
  periodStart: v.number(),
  // Credits reset here, and leftovers expire.
  periodEnd: v.number(),
  creditsGranted: v.number(),
  // A decimal, since a short reply costs a fraction of a credit. It can
  // pass creditsGranted, since a reply that starts always finishes.
  creditsUsed: v.number(),
});

/** A model call's tokens. */
export const vTokenCounts = v.object({
  // Input tokens that neither read nor wrote the prompt cache.
  inputTokens: v.number(),
  outputTokens: v.number(),
  cacheWriteTokens: v.number(),
  cacheReadTokens: v.number(),
});

/**
 * Why a Send moved a thread off its model: the model left the list, or the
 * user's plan doesn't include it (resolveReplyModel in lib/threadModels.ts).
 */
export const vModelSwitch = v.object({
  // The model the thread had. It can be an id that left the list.
  modelId: v.string(),
  reason: v.union(v.literal("removed"), v.literal("plan")),
});

export type ModelSwitch = Infer<typeof vModelSwitch>;

const vWaitingRun = v.union(
  v.object({ queuedPromptId: v.id("queuedPrompts") }),
  v.object({ promptMessageId: v.string() }),
);

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
  // One row per thread with action cards waiting in its last turn
  // (lib/pendingActions.ts), for the sidebar and the alerts. The thread's
  // messages hold the cards (ADR 0002), and this row only counts them. A
  // reply that pauses on cards adds it. A decision, a new prompt, a
  // regenerate, an edit, a Stop and deleting the thread update or delete
  // it. Archiving keeps it, and the lists skip archived threads.
  pendingActions: defineTable({
    userId: v.string(),
    threadId: v.string(),
    // How many cards are waiting.
    count: v.number(),
    // When the thread started waiting on the user.
    since: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_threadId", ["threadId"]),
  // One row per temporary thread (lib/temporaryThreads.ts). startThread
  // adds it with the thread, and deleting the thread deletes it. Its
  // creation time is when the thread started.
  temporaryThreads: defineTable({
    userId: v.string(),
    threadId: v.string(),
  })
    .index("by_userId", ["userId"])
    .index("by_threadId", ["threadId"]),
  // One row per thread with auto-approve on (lib/autoApprove.ts, ADR 0014).
  // setAutoApprove (convex/autoApprove.ts) adds it and deletes it, and
  // startThread adds it with the thread. Deleting the thread deletes it.
  // Archiving, pinning and sharing keep it.
  autoApproveThreads: defineTable({
    userId: v.string(),
    threadId: v.string(),
  }).index("by_threadId", ["threadId"]),
  // One row per thread with the model its replies use (lib/threadModels.ts).
  // startThread adds it, and sendMessage and the picker (setThreadModel in
  // convex/models.ts) change it. A thread with no row, like a scheduled
  // prompt's, uses the user's default model. Deleting the thread deletes it.
  threadModels: defineTable({
    userId: v.string(),
    threadId: v.string(),
    // An id from the model list (lib/models.ts). It can be one that left
    // the list.
    modelId: v.string(),
    // Set when a Send moved the thread off a model it couldn't use, for
    // the composer's note. The user's next Send, a new pick or the note's
    // dismiss button clears it.
    switchedFrom: v.optional(vModelSwitch),
  }).index("by_threadId", ["threadId"]),
  // One row per user who has set a preference (convex/models.ts). A user
  // with no row gets the defaults. Deleting the account deletes it.
  userPreferences: defineTable({
    userId: v.string(),
    // The model new threads start on. Unset means DEFAULT_MODEL_ID.
    defaultModelId: v.optional(v.string()),
  }).index("by_userId", ["userId"]),
  // One row per user who has seen the auto-approve warning, so the dialog
  // shows once per account (markWarningSeen in convex/autoApprove.ts).
  // Deleting the account deletes it.
  autoApproveWarnings: defineTable({
    userId: v.string(),
  }).index("by_userId", ["userId"]),
  // A thread's queued prompts (convex/chat/queue.ts), oldest first by
  // creation time. sendMessage adds one while a reply is running or the
  // queue isn't paused, and startNextPrompt (convex/chat/send.ts) removes
  // it when it starts. sendMessage checks the text and counts the Send
  // before it adds the row. A scheduled run (convex/scheduledPrompts.ts)
  // adds one too when it can't start right away.
  queuedPrompts: defineTable({
    threadId: v.string(),
    userId: v.string(),
    prompt: v.string(),
    attachmentFileIds: v.array(v.string()),
    // The browser's time zone when the prompt was queued, unchecked.
    timeZone: v.optional(v.string()),
    // Set when a scheduled run queued the prompt, so starting it moves the
    // scheduled prompt's waitingRun to the prompt message.
    scheduledPromptId: v.optional(v.id("scheduledPrompts")),
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
  // One row per scheduled prompt (convex/scheduledPrompts.ts, ADR 0013).
  // create adds it with its thread, and each run rewrites its next run.
  // Deleting the thread deletes the row (deleteThread in convex/threads.ts).
  scheduledPrompts: defineTable({
    userId: v.string(),
    // The thread every run sends into.
    threadId: v.string(),
    title: v.string(),
    // Text only. A scheduled prompt has no attachments.
    prompt: v.string(),
    schedule: vSchedule,
    // IANA name, such as "Europe/Berlin". Schedule times are local to it.
    timeZone: v.string(),
    // Whether each run sends the user an email.
    email: v.boolean(),
    status: vScheduledPromptStatus,
    // When the next run is due. Unset when none is scheduled: paused, or a
    // one-off that's done.
    nextRunAt: v.optional(v.number()),
    // The pending run in _scheduled_functions, so a change can cancel it.
    scheduledJobId: v.optional(v.id("_scheduled_functions")),
    // Failed runs in a row. Three pause the scheduled prompt.
    consecutiveFailures: v.number(),
    // Runs whose reply the user hasn't opened the thread to see.
    unreadRuns: v.number(),
    lastRun: v.optional(vLastRun),
    // The last run while it hasn't finished: its queued prompt, or its
    // prompt message once it starts. A run that comes due meanwhile is
    // skipped.
    waitingRun: v.optional(vWaitingRun),
  })
    .index("by_userId", ["userId"])
    .index("by_threadId", ["threadId"])
    .index("by_userId_and_status", ["userId", "status"])
    // For the sidebar's unread dots and count. The thread lists read only
    // rows with unread runs, so a run of any other row doesn't rerun them.
    .index("by_userId_and_unreadRuns", ["userId", "unreadRuns"]),
  // One row per shared snapshot (convex/sharedSnapshots.ts, ADR 0011). Its
  // public link opens `version` of its copied messages. Sharing again copies
  // the next version and switches to it once the copy is done. Unsharing or
  // deleting the thread deletes the row.
  sharedSnapshots: defineTable({
    threadId: v.string(),
    userId: v.string(),
    // The token in the link. Random, so it can't be guessed from the
    // thread ID.
    publicId: v.string(),
    // The thread's title when the live version was made.
    title: v.optional(v.string()),
    // The live version. 0 until the first copy is done.
    version: v.number(),
    // When the live version was made.
    updatedAt: v.optional(v.number()),
    // When the newest message the live version copied was made, so the
    // dialog can tell whether the thread has newer finished turns.
    copiedUpTo: v.optional(v.number()),
    // Set while version + 1 is being copied.
    copying: v.boolean(),
  })
    .index("by_threadId", ["threadId"])
    .index("by_publicId", ["publicId"]),
  // A shared snapshot's copied messages, redacted (lib/sharedMessages.ts).
  // One row per UI message.
  sharedSnapshotMessages: defineTable({
    snapshotId: v.id("sharedSnapshots"),
    version: v.number(),
    // Sorts the messages oldest first: the turn's order, and the reply
    // after its prompt.
    position: v.number(),
    message: vSharedMessage,
  }).index("by_snapshotId_and_version_and_position", [
    "snapshotId",
    "version",
    "position",
  ]),
  // One row per file a shared snapshot's version shows, so
  // cleanUpUnsentUploads keeps the file while the snapshot holds it.
  sharedSnapshotFiles: defineTable({
    snapshotId: v.id("sharedSnapshots"),
    version: v.number(),
    fileId: v.string(),
  })
    .index("by_fileId", ["fileId"])
    .index("by_snapshotId_and_version", ["snapshotId", "version"]),
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
  // The credit ledger (lib/credits.ts): one row per user per credit period,
  // only when billing is on. The first usage in a period opens its row, and
  // an upgrade ends the current row early and opens the next. The Billing
  // page reads the latest row. Deleting the account deletes the rows.
  creditLedger: defineTable({
    userId: v.string(),
    ...vCreditPeriod.fields,
  }).index("by_userId_and_periodStart", ["userId", "periodStart"]),
  // One row per recorded cost (record in convex/usage.ts), only when
  // billing is on, so the bill can be checked against real usage. Deleting
  // the account deletes the user's rows.
  usageEvents: defineTable({
    userId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    kind: vUsageKind,
    // Unset for a web search.
    model: v.optional(v.string()),
    tokens: v.optional(vTokenCounts),
    costUsd: v.number(),
    // What came off the user's credits. 0 for a title.
    credits: v.number(),
  }).index("by_userId", ["userId"]),
  // What a8 spent on models and searches across all users in a UTC day, in
  // USD, for the daily dollar ceiling. Every usage event adds to one of
  // DAILY_SPEND_SHARDS rows picked at random, so replies running at once
  // don't all write the same document. The day's spend is the rows' sum.
  dailySpend: defineTable({
    // "YYYY-MM-DD", in UTC.
    day: v.string(),
    shard: v.number(),
    usd: v.number(),
  }).index("by_day_and_shard", ["day", "shard"]),
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
