import { getThreadMetadata, type ThreadDoc } from "@convex-dev/agent";
import { ConvexError } from "convex/values";
import { components } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { authComponent } from "../auth";

type Ctx = QueryCtx | MutationCtx;

/** The signed-in user: a document from Better Auth's `user` table. */
export type Viewer = NonNullable<
  Awaited<ReturnType<typeof authComponent.safeGetAuthUser>>
>;

/**
 * The signed-in user, or null. `safeGetAuthUser` checks that the session
 * is still live, so a sign-out or revoked session takes effect immediately.
 */
export async function getViewer(ctx: Ctx): Promise<Viewer | null> {
  return (await authComponent.safeGetAuthUser(ctx)) ?? null;
}

export async function requireViewer(ctx: Ctx): Promise<Viewer> {
  const viewer = await getViewer(ctx);
  if (!viewer) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "Please sign in to continue.",
    });
  }
  return viewer;
}

/**
 * The Agent thread, if it exists and belongs to `viewerId`; otherwise null.
 * Pass `viewer._id` from getViewer or requireViewer, never a client argument.
 */
export async function getOwnedThread(
  ctx: Ctx,
  threadId: string,
  viewerId: string,
): Promise<ThreadDoc | null> {
  let thread: ThreadDoc;
  try {
    thread = await getThreadMetadata(ctx, components.agent, { threadId });
  } catch {
    // A deleted thread, or a string that isn't a thread ID at all.
    return null;
  }
  return thread.userId === viewerId ? thread : null;
}

/**
 * Like getOwnedThread, but always throws when there's no thread to return.
 * Missing and not-yours get the same error, so it never reveals that
 * someone else's thread exists.
 */
export async function requireOwnedThread(
  ctx: Ctx,
  threadId: string,
  viewerId: string,
): Promise<ThreadDoc> {
  const thread = await getOwnedThread(ctx, threadId, viewerId);
  if (!thread) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Chat not found." });
  }
  return thread;
}
