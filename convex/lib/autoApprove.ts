/**
 * Auto-approve is a thread setting under which actions run without an
 * action card (GLOSSARY.md, ADR 0014). A row in autoApproveThreads turns it
 * on. A reply reads it when it starts (getReplyStart in
 * convex/chat/reply.ts), and createReplyTools (lib/replyTools.ts) approves
 * up to MAX_AUTO_APPROVED_ACTIONS of its actions.
 */
import type { MessageDoc } from "@convex-dev/agent";
import type { ModelMessage, ToolApprovalStatus } from "ai";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * The most actions one reply runs without a card. Later ones in the reply
 * show cards. The count covers the whole reply, across continuations.
 */
export const MAX_AUTO_APPROVED_ACTIONS = 5;

/** The thread's autoApproveThreads row, or null if it has none. */
export function findAutoApproveThread(ctx: QueryCtx, threadId: string) {
  return ctx.db
    .query("autoApproveThreads")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .unique();
}

/**
 * Whether the thread has auto-approve on. A scheduled prompt thread never
 * has, even with a row, since its runs always stop on their cards (ADR
 * 0013).
 */
export function isAutoApproveOn(
  row: Doc<"autoApproveThreads"> | null,
  scheduledPrompt: Doc<"scheduledPrompts"> | null,
): boolean {
  return row !== null && scheduledPrompt === null;
}

/** The user's autoApproveWarnings row, or null if they haven't seen it. */
export function findAutoApproveWarning(ctx: QueryCtx, userId: string) {
  return ctx.db
    .query("autoApproveWarnings")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

/**
 * Turns each action's "user-approval" into a function that approves the
 * call while the reply has run fewer than MAX_AUTO_APPROVED_ACTIONS without
 * a card, and asks the user after that. The actions share one count.
 *
 * A continuing reply asks again about each call the user approved on a
 * card, and only a "denied" stops it. That call is already in the history,
 * so it runs and doesn't count.
 *
 * @param toolApproval Every action's entry. Reads have none.
 * @param autoApprovedCount The actions the reply ran without a card before
 *   it paused on action cards. 0 for a new reply.
 */
export function autoApproveActions(
  toolApproval: Record<string, ToolApprovalStatus>,
  autoApprovedCount: number,
): Record<string, AutoApproval> {
  let count = autoApprovedCount;
  const approve: AutoApproval = (_input, { toolCallId, messages }) => {
    if (hasToolCall(messages, toolCallId)) return "approved";
    if (count >= MAX_AUTO_APPROVED_ACTIONS) return "user-approval";
    count++;
    return "approved";
  };
  return Object.fromEntries(
    Object.keys(toolApproval).map((name) => [name, approve]),
  );
}

/** One action's entry in the reply's `toolApproval` under auto-approve. */
export type AutoApproval = (
  input: unknown,
  options: { toolCallId: string; messages: ModelMessage[] },
) => ToolApprovalStatus;

/** Whether the history already holds the tool call. */
function hasToolCall(messages: ModelMessage[], toolCallId: string): boolean {
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      Array.isArray(message.content) &&
      message.content.some(
        (part) => part.type === "tool-call" && part.toolCallId === toolCallId,
      ),
  );
}

/**
 * How many of the turn's actions ran without a card. The AI SDK marks the
 * approval request of each one `isAutomatic`.
 */
export function countAutoApproved(turn: MessageDoc[]): number {
  let count = 0;
  for (const { message } of turn) {
    if (!message || typeof message.content === "string") continue;
    for (const part of message.content) {
      if (part.type === "tool-approval-request" && part.isAutomatic === true) {
        count++;
      }
    }
  }
  return count;
}
