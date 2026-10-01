import { listMessages, listStreams } from "@convex-dev/agent";
import { ConvexError } from "convex/values";
import { components } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import { chatAgent } from "./agent";
import { MAX_REPLY_STEPS } from "./reply";
import { clearStop, turnStop } from "./stop";

/** A thread's last turn: its prompt, and the steps of its reply so far. */
export type LastTurn = {
  threadId: string;
  /** The Agent's `order`, which a prompt and its reply share. */
  order: number;
  promptMessageId: string;
  replyMessageIds: string[];
};

/**
 * The thread's last turn, once its reply is done: saved as a success or a
 * failure, or stopped with the reply runner done with it. Throws while it's
 * still on its way, since a second reply to the same prompt would race it.
 */
export async function finishedLastTurn(
  ctx: MutationCtx,
  threadId: string,
): Promise<LastTurn> {
  // Newest first, every status, and one reply's steps plus its prompt fit:
  // the last turn is all there.
  const { page } = await listMessages(ctx, components.agent, {
    threadId,
    paginationOpts: { numItems: 2 * MAX_REPLY_STEPS + 1, cursor: null },
  });
  const order = page[0]?.order;
  const turn = page.filter((message) => message.order === order);
  const prompt = turn.find((message) => message.message?.role === "user");
  if (order === undefined || !prompt) {
    throw new ConvexError({
      code: "NOTHING_TO_REGENERATE",
      message: "There's no reply to regenerate.",
    });
  }
  const reply = turn.filter((message) => message._id !== prompt._id);
  const stop = await turnStop(ctx, threadId, order);
  // A stopped runner can still be about to save a reply, or winding down
  // after its reply was saved. Clearing its stop would set it going again.
  // Without a stop, a turn with no reply yet is waiting for its runner.
  const inProgress =
    reply.some((message) => message.status === "pending") ||
    (stop ? !stop.settled : reply.length === 0);
  if (inProgress) {
    throw new ConvexError({
      code: "REPLY_IN_PROGRESS",
      message: "Wait for the reply to finish first.",
    });
  }
  return {
    threadId,
    order,
    promptMessageId: prompt._id,
    replyMessageIds: reply.map((message) => message._id),
  };
}

/**
 * Deletes the turn's reply, leaving its prompt for a new one. Every step
 * goes: any successful step left behind would reach the model as an
 * earlier reply to the prompt. So do its stream records, which would show
 * over the new reply, and its stop, which would end the new reply at once.
 */
export async function clearReply(
  ctx: MutationCtx,
  turn: LastTurn,
): Promise<void> {
  const { threadId, order } = turn;
  await chatAgent.deleteMessages(ctx, { messageIds: turn.replyMessageIds });
  const streams = await listStreams(ctx, components.agent, {
    threadId,
    startOrder: order,
    includeStatuses: ["streaming", "finished", "aborted"],
  });
  for (const { streamId } of streams.filter((s) => s.order === order)) {
    // Here rather than in the background, so the old stream is gone by the
    // time the client lists streams again. One reply's deltas fit.
    await ctx.runMutation(components.agent.streams.deleteStreamSync, {
      streamId,
    });
  }
  await clearStop(ctx, threadId, order);
}
