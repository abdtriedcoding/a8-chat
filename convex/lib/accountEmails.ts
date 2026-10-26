/**
 * Each account's email key (accountEmails in schema.ts, ADR 0019). With
 * billing on, sign-up refuses an email whose key an account has.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { authComponent } from "../auth";
import { emailKey } from "./emailKey";

// How many rows emailIsTaken reads for one key. Several only happen for
// accounts made before sign-up refused aliases, or rows a failed purge
// left.
const MAX_ACCOUNTS_PER_EMAIL_KEY = 10;

/** The user's accountEmails row, or null. */
export async function findAccountEmail(ctx: QueryCtx, userId: string) {
  return await ctx.db
    .query("accountEmails")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
}

/**
 * Whether an account has an email with this one's key. A row whose account
 * is gone doesn't count, so a purge that failed can't lock the inbox out.
 */
export async function emailIsTaken(ctx: QueryCtx, email: string) {
  const key = await emailKey(email);
  const rows = await ctx.db
    .query("accountEmails")
    .withIndex("by_emailKey", (q) => q.eq("emailKey", key))
    .take(MAX_ACCOUNTS_PER_EMAIL_KEY);
  for (const row of rows) {
    if (await authComponent.getAnyUserById(ctx, row.userId)) return true;
  }
  return false;
}

/** Adds the user's row, unless they have one. */
export async function addAccountEmail(
  ctx: MutationCtx,
  { userId, email }: { userId: string; email: string },
) {
  if (await findAccountEmail(ctx, userId)) return;
  await ctx.db.insert("accountEmails", {
    emailKey: await emailKey(email),
    userId,
  });
}

/** Deletes the user's row, for a deleted account. */
export async function deleteAccountEmail(ctx: MutationCtx, userId: string) {
  const row = await findAccountEmail(ctx, userId);
  if (row) await ctx.db.delete("accountEmails", row._id);
}
