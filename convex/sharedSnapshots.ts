// A shared snapshot is a read-only copy of a thread's finished turns, which
// its public link shows (ADR 0011). Sharing copies the turns in batches and
// switches the link to the copy once it's done. The copy redacts each
// message as it goes (lib/sharedMessages.ts), so these tables never hold
// anything private.
import {
  getThreadMetadata,
  toUIMessages,
  type MessageDoc,
} from "@convex-dev/agent";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  httpAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { waitingApprovalIds } from "./chat/approval";
import { getStoppedReply, isReplyInProgress } from "./chat/stop";
import { hasPendingReply, MAX_TURN_MESSAGES } from "./chat/turns";
import { getAttachmentKind } from "./lib/attachments";
import { appError, ERROR_CODES } from "./lib/errors";
import { authorizeThreadAccess, getOwnThread } from "./lib/guards";
import { replyModelIds } from "./lib/models";
import { isSharedFilePart, SHARED_FILES_PATH } from "./lib/sharedFiles";
import {
  redactMessage,
  vSharedMessage,
  type SharedMessage,
  type SharedPart,
} from "./lib/sharedMessages";
import { refuseTemporaryThread } from "./lib/temporaryThreads";
import { limitShare } from "./rateLimits";

/**
 * How many messages one copy batch reads: an unfinished last turn, a whole
 * finished turn, and one message of the turn before it. So every batch
 * copies at least one whole turn.
 */
const COPY_BATCH_SIZE = 2 * MAX_TURN_MESSAGES + 1;
/** How many message rows, then file rows, one delete batch deletes. */
const DELETE_BATCH_SIZE = 100;

/**
 * Shares the thread, or updates its link to the thread's finished turns.
 * The link keeps its URL. Copying runs in the background, and the link
 * shows the old version, or nothing on a first share, until it's done.
 * Returns the link's public ID.
 *
 * Throws if the thread is temporary or has no finished turns, or the user
 * hit their share limit. Does nothing while a copy is running, or when the
 * link already
 * has the thread's finished turns.
 */
export const share = mutation({
  args: { threadId: v.string() },
  returns: v.string(),
  handler: async (ctx, { threadId }) => {
    const user = await authorizeThreadAccess(ctx, threadId);
    await refuseTemporaryThread(ctx, threadId, "share");
    const snapshot = await findSnapshot(ctx, threadId);
    if (snapshot?.copying) return snapshot.publicId;

    const finished = await listFinishedMessages(
      ctx,
      threadId,
      COPY_BATCH_SIZE,
    );
    const copiedUpTo = finished.page[0]?._creationTime;
    if (copiedUpTo === undefined) {
      throw appError(
        ERROR_CODES.NOTHING_TO_SHARE,
        "This chat has no finished replies to share yet.",
      );
    }
    if (snapshot && !hasNewerTurns(snapshot, copiedUpTo)) {
      return snapshot.publicId;
    }

    const retryAfter = await limitShare(ctx, user._id);
    if (retryAfter !== null) {
      const minutes = Math.ceil(retryAfter / 60_000);
      throw appError(
        ERROR_CODES.RATE_LIMITED,
        `You've shared a lot this hour. Try again in ${minutes} min.`,
      );
    }

    let snapshotId: Id<"sharedSnapshots">;
    let publicId: string;
    let version: number;
    if (snapshot) {
      await ctx.db.patch("sharedSnapshots", snapshot._id, { copying: true });
      ({ _id: snapshotId, publicId } = snapshot);
      version = snapshot.version + 1;
    } else {
      publicId = newPublicId();
      snapshotId = await ctx.db.insert("sharedSnapshots", {
        threadId,
        publicId,
        version: 0,
        copying: true,
      });
      version = 1;
    }
    // The first batch runs here, so it copies the turns this transaction
    // read. A regenerate or an edit can only change the last turn, and the
    // later batches copy older turns.
    await copyMessages(ctx, {
      snapshotId,
      threadId,
      version,
      copiedUpTo,
      ...finished,
    });
    return publicId;
  },
});

/** Copies the next batch of a share, older than the turns copied so far. */
export const continueCopy = internalMutation({
  args: {
    snapshotId: v.id("sharedSnapshots"),
    version: v.number(),
    copiedUpTo: v.number(),
    // A message of the newest turn left to copy.
    upToMessageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { snapshotId, version, copiedUpTo, upToMessageId }) => {
    const snapshot = await ctx.db.get("sharedSnapshots", snapshotId);
    // The user unshared or deleted the thread.
    if (!snapshot?.copying || snapshot.version + 1 !== version) return null;
    const [upTo] = await ctx.runQuery(
      components.agent.messages.getMessagesByIds,
      { messageIds: [upToMessageId] },
    );
    if (!upTo) {
      // Only the thread's last turn can change, and earlier batches copied
      // it, so this shouldn't happen. Without the message, the list would
      // have no upper bound, so this drops the copy instead.
      if (snapshot.version === 0) {
        await ctx.db.delete("sharedSnapshots", snapshotId);
      } else {
        await ctx.db.patch("sharedSnapshots", snapshotId, { copying: false });
      }
      await scheduleRowDeletion(ctx, snapshotId, version);
      return null;
    }
    const { page, isDone } = await ctx.runQuery(
      components.agent.messages.listMessagesByThreadId,
      {
        threadId: snapshot.threadId,
        order: "desc",
        upToAndIncludingMessageId: upToMessageId,
        paginationOpts: { numItems: COPY_BATCH_SIZE, cursor: null },
      },
    );
    await copyMessages(ctx, {
      snapshotId,
      threadId: snapshot.threadId,
      version,
      copiedUpTo,
      page,
      isDone,
    });
    return null;
  },
});

/**
 * Copies one batch of messages into `version`, newest first. Unless the
 * batch reaches the thread's first message, its oldest turn may go on past
 * the page, so it's left for the next batch, which this schedules. The last
 * batch makes the version live.
 */
async function copyMessages(
  ctx: MutationCtx,
  args: {
    snapshotId: Id<"sharedSnapshots">;
    threadId: string;
    version: number;
    copiedUpTo: number;
    page: MessageDoc[];
    isDone: boolean;
  },
) {
  const { snapshotId, threadId, version, copiedUpTo, page, isDone } = args;
  const oldestOrder = page.at(-1)?.order;
  // A page always holds a whole turn (COPY_BATCH_SIZE), so this only guards
  // against copying the same turn forever.
  const split =
    !isDone && page.some((message) => message.order !== oldestOrder);
  const nextTurn = split
    ? page.filter((message) => message.order === oldestOrder)
    : [];
  const batch = split
    ? page.filter((message) => message.order !== oldestOrder)
    : page;

  const modelIds = replyModelIds(batch);
  // A prompt's UI message has its message's ID.
  const promptFileIds = new Map(
    batch.map((message) => [message._id, message.fileIds ?? []]),
  );
  for (const message of toUIMessages(batch)) {
    const shared = redactMessage(
      message,
      modelIds.get(message.order),
      promptFileIds.get(message.id) ?? [],
    );
    if (!shared) continue;
    await ctx.db.insert("sharedSnapshotMessages", {
      snapshotId,
      version,
      position: shared.order * 2 + (shared.role === "assistant" ? 1 : 0),
      message: shared,
    });
  }
  const fileIds = new Set(
    batch.flatMap((message) =>
      message.message?.role === "user" ? (message.fileIds ?? []) : [],
    ),
  );
  for (const fileId of fileIds) {
    await ctx.db.insert("sharedSnapshotFiles", { snapshotId, version, fileId });
  }

  if (nextTurn.length > 0) {
    await ctx.scheduler.runAfter(0, internal.sharedSnapshots.continueCopy, {
      snapshotId,
      version,
      copiedUpTo,
      upToMessageId: nextTurn[0]._id,
    });
    return;
  }

  const thread = await getThreadMetadata(ctx, components.agent, { threadId });
  await ctx.db.patch("sharedSnapshots", snapshotId, {
    version,
    copying: false,
    title: thread.title,
    updatedAt: Date.now(),
    copiedUpTo,
  });
  if (version > 1) await scheduleRowDeletion(ctx, snapshotId, version - 1);
}

/**
 * Unshares the thread. The link stops working at once, and sharing again
 * makes a new one. Does nothing if the thread isn't shared.
 */
export const unshare = mutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    await authorizeThreadAccess(ctx, threadId);
    await deleteThreadSnapshot(ctx, threadId);
    return null;
  },
});

/**
 * Deletes the thread's shared snapshot, if it has one. Its messages and
 * files go in batches in the background. Deleting a thread calls this.
 */
export async function deleteThreadSnapshot(ctx: MutationCtx, threadId: string) {
  const snapshot = await findSnapshot(ctx, threadId);
  if (!snapshot) return;
  await ctx.db.delete("sharedSnapshots", snapshot._id);
  await scheduleRowDeletion(ctx, snapshot._id);
}

function scheduleRowDeletion(
  ctx: MutationCtx,
  snapshotId: Id<"sharedSnapshots">,
  version?: number,
) {
  return ctx.scheduler.runAfter(0, internal.sharedSnapshots.deleteRows, {
    snapshotId,
    version,
  });
}

/**
 * Deletes a batch of a snapshot's message and file rows, from one version
 * or, without `version`, from all of them. Schedules itself until none are
 * left.
 */
export const deleteRows = internalMutation({
  args: {
    snapshotId: v.id("sharedSnapshots"),
    version: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { snapshotId, version }) => {
    const messages = await ctx.db
      .query("sharedSnapshotMessages")
      .withIndex("by_snapshotId_and_version_and_position", (q) =>
        version === undefined
          ? q.eq("snapshotId", snapshotId)
          : q.eq("snapshotId", snapshotId).eq("version", version),
      )
      .take(DELETE_BATCH_SIZE);
    for (const row of messages) {
      await ctx.db.delete("sharedSnapshotMessages", row._id);
    }
    const files = await ctx.db
      .query("sharedSnapshotFiles")
      .withIndex("by_snapshotId_and_version_and_fileId", (q) =>
        version === undefined
          ? q.eq("snapshotId", snapshotId)
          : q.eq("snapshotId", snapshotId).eq("version", version),
      )
      .take(DELETE_BATCH_SIZE);
    for (const row of files) {
      await ctx.db.delete("sharedSnapshotFiles", row._id);
    }
    if (
      messages.length === DELETE_BATCH_SIZE ||
      files.length === DELETE_BATCH_SIZE
    ) {
      await scheduleRowDeletion(ctx, snapshotId, version);
    }
    return null;
  },
});

/**
 * The share dialog's view of the thread: whether it has finished turns to
 * share, and its link if it's shared. Null when signed out or the thread
 * isn't the user's.
 */
export const getShareStatus = query({
  args: { threadId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      hasFinishedTurns: v.boolean(),
      link: v.union(
        v.null(),
        v.object({
          publicId: v.string(),
          // When the live version was made. Unset while the first copy runs.
          updatedAt: v.optional(v.number()),
          copying: v.boolean(),
          // Whether the thread has finished turns the link doesn't show.
          hasNewerTurns: v.boolean(),
        }),
      ),
    }),
  ),
  handler: async (ctx, { threadId }) => {
    if (!(await getOwnThread(ctx, threadId))) return null;
    // Enough to hold an unfinished last turn and a message of the turn
    // before it.
    const { page } = await listFinishedMessages(
      ctx,
      threadId,
      MAX_TURN_MESSAGES + 1,
    );
    const newest = page[0]?._creationTime;
    const snapshot = await findSnapshot(ctx, threadId);
    return {
      hasFinishedTurns: newest !== undefined,
      link: snapshot && {
        publicId: snapshot.publicId,
        updatedAt: snapshot.updatedAt,
        copying: snapshot.copying,
        hasNewerTurns: newest !== undefined && hasNewerTurns(snapshot, newest),
      },
    };
  },
});

/**
 * The shared snapshot behind a link: its title and live version. Anyone can
 * read it, signed in or not. Null for a link that was unshared, deleted or
 * never existed, and for a first share that's still copying.
 */
export const getSharedSnapshot = query({
  args: { publicId: v.string() },
  returns: v.union(
    v.null(),
    v.object({ title: v.optional(v.string()), version: v.number() }),
  ),
  handler: async (ctx, { publicId }) => {
    const snapshot = await findLiveSnapshot(ctx, publicId);
    return snapshot && { title: snapshot.title, version: snapshot.version };
  },
});

/** The most messages one page of listSharedMessages returns. */
const MAX_SHARED_MESSAGES_PER_PAGE = 50;

/**
 * A page of a shared snapshot's messages, oldest first. Anyone can read it.
 * `version` comes from getSharedSnapshot, so a switch to a new version
 * starts the pages over. Empty once the version isn't live.
 */
export const listSharedMessages = query({
  args: {
    publicId: v.string(),
    version: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(
    v.object({ _id: v.id("sharedSnapshotMessages"), message: vSharedMessage }),
  ),
  handler: async (ctx, { publicId, version, paginationOpts }) => {
    const snapshot = await findLiveSnapshot(ctx, publicId);
    if (snapshot?.version !== version) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    const result = await ctx.db
      .query("sharedSnapshotMessages")
      .withIndex("by_snapshotId_and_version_and_position", (q) =>
        q.eq("snapshotId", snapshot._id).eq("version", version),
      )
      // Anyone can call this, and they pick numItems, so cap it.
      .paginate({
        ...paginationOpts,
        numItems: Math.min(
          paginationOpts.numItems,
          MAX_SHARED_MESSAGES_PER_PAGE,
        ),
      });
    return {
      ...result,
      page: result.page.map(({ _id, message }) => ({
        _id,
        message: withoutStorageUrls(message),
      })),
    };
  },
});

/**
 * A file the link's live version shows, for serveSharedFile. Null once the
 * link is unshared or the file isn't one a8 accepts as an attachment.
 */
export const getSharedFile = internalQuery({
  args: { publicId: v.string(), fileId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      storageId: v.id("_storage"),
      mediaType: v.string(),
      filename: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { publicId, fileId }) => {
    const snapshot = await findLiveSnapshot(ctx, publicId);
    if (!snapshot) return null;
    const row = await ctx.db
      .query("sharedSnapshotFiles")
      .withIndex("by_snapshotId_and_version_and_fileId", (q) =>
        q
          .eq("snapshotId", snapshot._id)
          .eq("version", snapshot.version)
          .eq("fileId", fileId),
      )
      .unique();
    if (!row) return null;
    const file = await ctx.runQuery(components.agent.files.get, { fileId });
    const mediaType = file?.mediaType ?? file?.mimeType;
    if (!file || !mediaType || !getAttachmentKind(mediaType)) return null;
    return {
      // The Agent's files table types it as a string.
      storageId: file.storageId as Id<"_storage">,
      mediaType,
      ...(file.filename !== undefined && { filename: file.filename }),
    };
  },
});

/**
 * Serves a shared page's attachment at sharedFilePath. 404 unless the link
 * is live and its live version shows the file. The response says not to
 * store it, so a browser asks again and gets a 404 once it's unshared.
 */
export const serveSharedFile = httpAction(async (ctx, request) => {
  const [publicId, fileId, ...rest] = new URL(request.url).pathname
    .slice(SHARED_FILES_PATH.length)
    .split("/");
  const file =
    publicId && fileId && rest.length === 0
      ? await ctx.runQuery(internal.sharedSnapshots.getSharedFile, {
          publicId,
          fileId,
        })
      : null;
  const blob = file && (await ctx.storage.get(file.storageId));
  if (!file || !blob) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    "Content-Type": file.mediaType,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (file.filename !== undefined) {
    headers.set(
      "Content-Disposition",
      // RFC 5987 doesn't allow the ' that encodeURIComponent keeps.
      `inline; filename*=UTF-8''${encodeURIComponent(file.filename).replaceAll("'", "%27")}`,
    );
  }
  return new Response(blob, { headers });
});

/**
 * The message without the storage URLs that rows copied before a8 kept file
 * IDs still hold, and without their file parts, which the page can't load
 * until migrations:replaceSharedFileUrlsWithIds gives them file IDs.
 */
function withoutStorageUrls(message: SharedMessage): SharedMessage {
  return {
    ...message,
    parts: message.parts.flatMap((part): SharedPart[] => {
      if (!isSharedFilePart(part)) return [part];
      if (part.fileId === undefined) return [];
      return [
        {
          type: part.type,
          mediaType: part.mediaType,
          fileId: part.fileId,
          ...(part.filename !== undefined && { filename: part.filename }),
        },
      ];
    }),
  };
}

/** Whether a shared snapshot shows the file. Upload cleanup keeps it then. */
export async function isSharedFile(ctx: QueryCtx, fileId: string) {
  const row = await ctx.db
    .query("sharedSnapshotFiles")
    .withIndex("by_fileId", (q) => q.eq("fileId", fileId))
    .first();
  return row !== null;
}

/**
 * Whether the thread's newest finished message, made at `newest`, is newer
 * than the snapshot's copy. This goes by time, not by ID: while the user
 * regenerates or edits the copied last turn, the newest finished message is
 * an older one, and the link shouldn't offer to go back to it.
 */
function hasNewerTurns(snapshot: Doc<"sharedSnapshots">, newest: number) {
  return snapshot.copiedUpTo === undefined || newest > snapshot.copiedUpTo;
}

function findSnapshot(ctx: QueryCtx, threadId: string) {
  return ctx.db
    .query("sharedSnapshots")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .unique();
}

/** The snapshot behind a link, or null until its first copy is done. */
async function findLiveSnapshot(ctx: QueryCtx, publicId: string) {
  const snapshot = await ctx.db
    .query("sharedSnapshots")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .unique();
  return snapshot && snapshot.version > 0 ? snapshot : null;
}

/**
 * The thread's newest messages, newest first, starting at its last finished
 * turn. The last turn isn't finished while its reply runs, waits on an
 * action card or waits to continue. A stopped or failed reply is finished.
 * `numItems` must be over MAX_TURN_MESSAGES, so the page holds the whole
 * last turn.
 */
async function listFinishedMessages(
  ctx: QueryCtx,
  threadId: string,
  numItems: number,
) {
  const { page, isDone } = await ctx.runQuery(
    components.agent.messages.listMessagesByThreadId,
    { threadId, order: "desc", paginationOpts: { numItems, cursor: null } },
  );
  const order = page[0]?.order;
  if (order === undefined) return { page, isDone };
  const lastTurn = page.filter((message) => message.order === order);
  if (await isTurnFinished(ctx, threadId, lastTurn)) return { page, isDone };
  return {
    page: page.filter((message) => message.order !== order),
    isDone,
  };
}

/** @param turn The turn's messages, newest first. */
async function isTurnFinished(
  ctx: QueryCtx,
  threadId: string,
  turn: MessageDoc[],
): Promise<boolean> {
  // A stopped reply is still pending until the runner saves what it had.
  if (hasPendingReply(turn)) return false;
  if (await getStoppedReply(ctx, threadId, turn[0].order)) return true;
  return !isReplyInProgress(turn) && waitingApprovalIds(turn).length === 0;
}

/** A random link token of 128 bits, as hex. */
function newPublicId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
