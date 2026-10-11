import { listMessages, type MessageDoc } from "@convex-dev/agent";
import { components } from "../_generated/api";
import type { QueryCtx } from "../_generated/server";
import { MAX_REPLY_STEPS } from "../agents/chat";

/**
 * The most messages one turn holds: the prompt, and for each step of the
 * reply the model's message and its tool results. A step that paused on
 * action cards also saves the user's decisions, and the results of the
 * actions they approved.
 */
const MAX_TURN_MESSAGES = 4 * MAX_REPLY_STEPS + 1;

/** The thread's last turn, newest message first, with every status. */
export async function getLastTurn(
  ctx: QueryCtx,
  threadId: string,
): Promise<MessageDoc[]> {
  const { page } = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { numItems: MAX_TURN_MESSAGES, cursor: null },
  });
  const order = page[0]?.order;
  return page.filter((message) => message.order === order);
}

/**
 * Whether the turn's reply is still running. It's true while the turn holds
 * a pending message, which includes the time the runner spends on actions
 * the user approved. A turn with only its prompt has no pending message. Its
 * runner hasn't started yet, or it stopped before saving anything. A reply
 * paused on action cards has none either, so a new prompt can still cancel
 * the cards.
 */
export function hasPendingReply(turn: MessageDoc[]): boolean {
  return turn.some((message) => message.status === "pending");
}

/**
 * The turn's messages up to and including `promptMessageId`, newest first.
 * The list starts there, so messages the user sent afterwards don't push
 * the turn off the page. The page size fits the prompt plus everything one
 * reply can save.
 *
 * Null once a regenerate or an edit has deleted the message. Without it,
 * the list would have no upper bound, and would read a newer turn at the
 * same order.
 */
export async function listTurnUpTo(
  ctx: QueryCtx,
  {
    threadId,
    promptMessageId,
    order,
  }: { threadId: string; promptMessageId: string; order: number },
): Promise<MessageDoc[] | null> {
  if (!(await promptExists(ctx, promptMessageId))) return null;
  const { page } = await ctx.runQuery(
    components.agent.messages.listMessagesByThreadId,
    {
      threadId,
      upToAndIncludingMessageId: promptMessageId,
      order: "desc",
      paginationOpts: { numItems: MAX_TURN_MESSAGES, cursor: null },
    },
  );
  return page.filter((message) => message.order === order);
}

/** False once a regenerate or an edit has deleted the prompt. */
async function promptExists(ctx: QueryCtx, promptMessageId: string) {
  const [prompt] = await ctx.runQuery(
    components.agent.messages.getMessagesByIds,
    { messageIds: [promptMessageId] },
  );
  return Boolean(prompt);
}
