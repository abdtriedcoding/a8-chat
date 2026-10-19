import { Resend } from "@convex-dev/resend";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { env, internalMutation } from "./_generated/server";
import { authComponent } from "./auth";
import { resetPasswordEmail, verificationEmail } from "./lib/authEmails";
import { runEmail, vRunEmailKind } from "./lib/runEmails";

// Resend only delivers to its own test addresses while testMode is on, which
// RESEND_TEST_MODE="true" turns on. Unset, a8 sends to real addresses.
const resend = new Resend(components.resend, {
  apiKey: env.RESEND_API_KEY,
  testMode: env.RESEND_TEST_MODE === "true",
});

// Queues the email and returns. The component sends it from its own workpool,
// so auth responses don't wait on Resend.
export const sendAuthEmail = internalMutation({
  args: {
    kind: v.union(v.literal("verification"), v.literal("resetPassword")),
    to: v.string(),
    url: v.string(),
  },
  handler: async (ctx, { kind, to, url }) => {
    const email =
      kind === "verification" ? verificationEmail(url) : resetPasswordEmail(url);
    await resend.sendEmail(ctx, { from: env.EMAIL_FROM, to, ...email });
  },
});

// Queues a scheduled run's email (recordRunOutcome and recordFailedRun in
// convex/scheduledPrompts.ts call it when the row's email is on). Both links
// use SITE_URL. Does nothing when the user is gone.
export const sendRunEmail = internalMutation({
  args: {
    kind: vRunEmailKind,
    userId: v.string(),
    threadId: v.string(),
    title: v.string(),
    // The reply's text, or what it had so far.
    reply: v.string(),
    failures: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { userId, threadId, ...args }) => {
    const user = await authComponent.getAnyUserById(ctx, userId);
    if (!user) return null;
    const email = runEmail({
      ...args,
      threadUrl: new URL(`/c/${threadId}`, env.SITE_URL).href,
      scheduledUrl: new URL("/scheduled", env.SITE_URL).href,
    });
    await resend.sendEmail(ctx, {
      from: env.EMAIL_FROM,
      to: user.email,
      ...email,
    });
    return null;
  },
});
