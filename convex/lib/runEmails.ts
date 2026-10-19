import { v, type Infer } from "convex/values";
import { escapeHtml, type AuthEmail } from "./authEmails";

/**
 * Which email a scheduled run sends: its reply, a reply that stopped on an
 * action card, or the pause after too many failed runs.
 */
export const vRunEmailKind = v.union(
  v.literal("reply"),
  v.literal("actionWaiting"),
  v.literal("paused"),
);

export type RunEmailKind = Infer<typeof vRunEmailKind>;

type RunEmailInput = {
  kind: RunEmailKind;
  /** The scheduled prompt's title. */
  title: string;
  /** The reply's text, or what it had so far. Empty when it has none. */
  reply: string;
  /** Failed runs in a row, for "paused". */
  failures: number;
  /** Opens the scheduled prompt's thread. */
  threadUrl: string;
  /** Opens the Scheduled page, where the user turns email off. */
  scheduledUrl: string;
};

export function runEmail({
  kind,
  title,
  reply,
  failures,
  threadUrl,
  scheduledUrl,
}: RunEmailInput): AuthEmail {
  const { subject, note } = {
    reply: { subject: title, note: "" },
    actionWaiting: {
      subject: `${title} is waiting for you`,
      note: "The reply stopped on an action that needs your approval. Open the chat to approve or cancel it.",
    },
    paused: {
      subject: `${title} paused after ${failures} failed runs`,
      note: `This scheduled task failed ${failures} runs in a row, so a8 paused it. Resume it on the Scheduled page.`,
    },
  }[kind];
  const footer =
    "You get this email because it's on for this scheduled task. Turn it off on the Scheduled page:";

  const text = [
    note,
    reply && (kind === "actionWaiting" ? `Reply so far:\n\n${reply}` : reply),
    `Open the chat: ${threadUrl}`,
    `${footer} ${scheduledUrl}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const href = escapeHtml(threadUrl);
  const turnOff = escapeHtml(scheduledUrl);
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
<p style="font-size:20px;font-weight:700;margin:0 0 24px">a8</p>
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>
${note ? `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(note)}</p>` : ""}
${reply ? `<div style="margin:0 0 24px;line-height:1.5;white-space:pre-wrap">${escapeHtml(reply)}</div>` : ""}
<p style="margin:0 0 24px"><a href="${href}" style="background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Open the chat</a></p>
<p style="margin:0;font-size:13px;color:#555;line-height:1.5">${escapeHtml(footer)}<br><a href="${turnOff}" style="color:#555;word-break:break-all">${turnOff}</a></p>
</div>`;

  return { subject, text, html };
}
