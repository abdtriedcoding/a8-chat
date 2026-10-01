import { createThread } from "@convex-dev/agent";
import { components, internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import { requireOwnedThread, requireViewer } from "./access";
import { chatAgent } from "./agent";
import { assertModelConfigured } from "./models";
import { clearReply, finishedLastTurn } from "./regenerate";
import { normalizePrompt, titleFromPrompt } from "./text";

const FALLBACK_TIME_ZONE = "UTC";

/** A Send, as the public entry points pass it. Edit joins as a new kind. */
export type Send = (
  | { kind: "startThread"; prompt: string }
  | { kind: "sendPrompt"; threadId: string; prompt: string }
  | { kind: "regenerate"; threadId: string }
) & {
  /** The browser's IANA time zone, unchecked. */
  timeZone?: string;
};

/**
 * The one path every Send takes: the checks, then save the prompt (or
 * reuse the last one), then schedule the reply. The checks run before
 * anything is saved, in order: the viewer and the thread's owner, the
 * prompt (or, for a regenerate, that the last reply is done), the model.
 * Stage 2's rate limits and attachment checks go after the model check.
 */
export async function send(
  ctx: MutationCtx,
  input: Send,
): Promise<{ threadId: string }> {
  const viewer = await requireViewer(ctx);
  if (input.kind !== "startThread") {
    await requireOwnedThread(ctx, input.threadId, viewer._id);
  }
  const replyTo =
    input.kind === "regenerate"
      ? { lastTurn: await finishedLastTurn(ctx, input.threadId) }
      : { prompt: normalizePrompt(input.prompt) };
  assertModelConfigured();

  let turn: { threadId: string; order: number; promptMessageId: string };
  if (replyTo.lastTurn) {
    // No versions: the old reply goes, and the turns before it stay as they are.
    await clearReply(ctx, replyTo.lastTurn);
    turn = replyTo.lastTurn;
  } else {
    // The only place threads are created.
    const threadId =
      input.kind === "startThread"
        ? await createThread(ctx, components.agent, {
            userId: viewer._id,
            title: titleFromPrompt(replyTo.prompt),
          })
        : input.threadId;
    const { messageId, message } = await chatAgent.saveMessage(ctx, {
      threadId,
      userId: viewer._id,
      prompt: replyTo.prompt,
      skipEmbeddings: true,
    });
    turn = { threadId, order: message.order, promptMessageId: messageId };
  }
  await ctx.scheduler.runAfter(0, internal.chat.streamReply, {
    threadId: turn.threadId,
    order: turn.order,
    promptMessageId: turn.promptMessageId,
    userId: viewer._id,
    timeZone: resolveTimeZone(input.timeZone),
  });
  return { threadId: turn.threadId };
}

/** The time zone if the runtime knows it, otherwise UTC. */
function resolveTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return FALLBACK_TIME_ZONE;
  try {
    // Throws a RangeError for a time zone it doesn't know.
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}
