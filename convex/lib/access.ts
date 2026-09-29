import { ConvexError } from "convex/values";
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
