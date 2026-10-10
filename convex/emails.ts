import { Resend } from "@convex-dev/resend";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { env, internalMutation } from "./_generated/server";
import { resetPasswordEmail, verificationEmail } from "./lib/authEmails";

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
