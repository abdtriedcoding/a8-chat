import { createThread } from "@convex-dev/agent";
import { components, internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import { requireOwnedThread, requireViewer } from "./access";
import { chatAgent } from "./agent";
import { assertModelConfigured } from "./models";
import { normalizePrompt, titleFromPrompt } from "./text";

const FALLBACK_TIME_ZONE = "UTC";

/**
 * A Send, as the public entry points pass it. Regenerate and edit join as
 * new kinds.
 */
export type Send = (
  | { kind: "startThread"; prompt: string }
  | { kind: "sendPrompt"; threadId: string; prompt: string }
) & {
  /** The browser's IANA time zone, unchecked. */
  timeZone?: string;
};

/**
 * The one path every Send takes: the checks, then save the prompt, then
 * schedule the reply. The checks run before anything is saved, in order:
 * the viewer and the thread's owner, the prompt, the model. Stage 2's rate
 * limits and attachment checks go after the model check.
 */
export async function send(
  ctx: MutationCtx,
  input: Send,
): Promise<{ threadId: string }> {
  const viewer = await requireViewer(ctx);
  if (input.kind === "sendPrompt") {
    await requireOwnedThread(ctx, input.threadId, viewer._id);
  }
  const prompt = normalizePrompt(input.prompt);
  assertModelConfigured();

  let threadId: string;
  if (input.kind === "startThread") {
    // The only place threads are created.
    threadId = await createThread(ctx, components.agent, {
      userId: viewer._id,
      title: titleFromPrompt(prompt),
    });
  } else {
    threadId = input.threadId;
  }
  const { messageId, message } = await chatAgent.saveMessage(ctx, {
    threadId,
    userId: viewer._id,
    prompt,
    skipEmbeddings: true,
  });
  await ctx.scheduler.runAfter(0, internal.chat.streamReply, {
    threadId,
    order: message.order,
    promptMessageId: messageId,
    userId: viewer._id,
    timeZone: resolveTimeZone(input.timeZone),
  });
  return { threadId };
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
