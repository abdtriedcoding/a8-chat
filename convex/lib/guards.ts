/**
 * Session and ownership checks. The rule: queries return empty when signed
 * out, since the session can end under a live query. Mutations and actions
 * throw the unauthenticated error.
 *
 * Only this module and getCurrentUser (convex/auth.ts) read the session.
 */
import { getThreadMetadata } from "@convex-dev/agent";
import { ConvexError } from "convex/values";
import { components } from "../_generated/api";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { authComponent } from "../auth";

/** The error every signed-out mutation and action throws. */
export function unauthenticated() {
  return new ConvexError({
    code: "UNAUTHENTICATED",
    message: "Please sign in to continue.",
  });
}

/** The signed-in user. Throws when signed out. For mutations. */
export async function requireUser(ctx: QueryCtx | MutationCtx) {
  const user = await authComponent.safeGetAuthUser(ctx);
  if (!user) throw unauthenticated();
  return user;
}

/** The signed-in user, or null when signed out. For queries. */
export async function optionalUser(ctx: QueryCtx | MutationCtx) {
  return (await authComponent.safeGetAuthUser(ctx)) ?? null;
}

/**
 * The signed-in user's ID. Throws when signed out. An action can't read the
 * user table, but Better Auth sets the identity's `subject` to the user ID.
 */
export async function requireIdentity(ctx: ActionCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw unauthenticated();
  return identity.subject;
}

/** The thread, or null when signed out or it isn't the user's. For queries. */
export async function getOwnThread(ctx: QueryCtx, threadId: string) {
  const user = await optionalUser(ctx);
  if (!user) return null;
  return findOwnThread(ctx, user._id, threadId);
}

/**
 * Throws unless the signed-in user owns the thread, and returns the user.
 * For mutations.
 */
export async function authorizeThreadAccess(
  ctx: MutationCtx,
  threadId: string,
) {
  const user = await requireUser(ctx);
  if (!(await findOwnThread(ctx, user._id, threadId))) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Chat not found." });
  }
  return user;
}

/** The thread if `userId` owns it, else null. */
export async function findOwnThread(
  ctx: QueryCtx,
  userId: string,
  threadId: string,
) {
  const thread = await getThreadMetadata(ctx, components.agent, {
    threadId,
  }).catch(() => null);
  return thread?.userId === userId ? thread : null;
}
