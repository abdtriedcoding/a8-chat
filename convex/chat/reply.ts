// See the docs at https://docs.convex.dev/agents/streaming
import {
  getThreadMetadata,
  listMessages,
  stepCountIs,
} from "@convex-dev/agent";
import { v, type Infer } from "convex/values";
import { components, internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server";
import { chatAgent } from "../agents/chat";
import { readUserConnections } from "../connections";
import { findAutoApproveThread, isAutoApproveOn } from "../lib/autoApprove";
import { replaceUnreadableAttachments } from "../lib/attachments";
import { gatewayOptions, languageModelFor } from "../lib/gateway";
import { replyInstructions } from "../lib/instructions";
import { modelOrDefault } from "../lib/models";
import {
  findThreadScheduledPrompt,
  type RunEnding,
} from "../lib/scheduledPrompts";
import { findTemporaryThread } from "../lib/temporaryThreads";
import { resolveReplyModel } from "../lib/threadModels";
import {
  CACHE_BREAKPOINT,
  createReplyTools,
  withCacheBreakpoint,
  type ReplyTools,
} from "../lib/replyTools";
import schema from "../schema";
import { canSearchWeb } from "../tools/webSearch";
import { getStoppedReply } from "./stop";
import { getContinuedTurn, listTurnUpTo } from "./turns";

/** The error saved on a reply that failed before the model call. */
const REPLY_START_FAILED = "The reply failed before the model call";

/**
 * How long a reply can run before its next step has to be its last. Convex
 * stops an action at 10 minutes, so this leaves time for the final text.
 */
const REPLY_TIME_LIMIT_MS = 8 * 60 * 1000;

/**
 * Gets the model's reply to a prompt and streams its text into the thread
 * as it arrives. sendPrompt schedules it, and decideAction schedules it
 * again to continue a reply that paused on action cards. Once the reply
 * ends, it records how a scheduled run went and how many cards wait, and
 * starts the thread's next queued prompt. Once it fails, it pauses the
 * queue.
 */
export const streamReply = internalAction({
  args: {
    // The prompt, or the user's decisions on action cards when continuing.
    promptMessageId: v.string(),
    threadId: v.string(),
    // The prompt's order. The reply gets the same one.
    order: v.number(),
    timeZone: v.string(),
    // Whether the reply continues after action cards.
    continuing: v.optional(v.boolean()),
    // The steps the reply took before it paused on action cards.
    stepsTaken: v.optional(v.number()),
    // The actions the reply ran without a card before it paused on action
    // cards.
    autoApprovedCount: v.optional(v.number()),
  },
  handler: async (
    ctx,
    {
      promptMessageId,
      threadId,
      order,
      timeZone,
      continuing = false,
      stepsTaken = 0,
      autoApprovedCount = 0,
    },
  ) => {
    const startedAt = Date.now();
    let replyTools: ReplyTools | undefined;
    // Set when the reply's stream is aborted, which is how Stop reaches the
    // runner (stopReply). The Agent then saves the partial reply as failed
    // and returns without an error. A Stop that lands after the model's last
    // word, while the Agent saves the final text, fails the reply without
    // this. That reply keeps its text on screen, but the model doesn't see it.
    let aborted = false;
    // Set when the reply ended normally, which includes pausing on action
    // cards. The runner then calls startNextPrompt. A runner that returned
    // early, failed or was stopped doesn't.
    let endedNormally = false;
    // How the reply ended, for its scheduled run (recordRunOutcome). Unset
    // when the thread was deleted under it.
    let ending: RunEnding | undefined = "notStarted";
    try {
      // Null if the user pressed Stop first, a regenerate or an edit
      // replaced this turn, or a new prompt came after the action cards
      // this reply continues from.
      const start: ReplyStart = await ctx.runQuery(
        internal.chat.reply.getReplyStart,
        { threadId, promptMessageId, order, continuing },
      );
      if (!start) return;
      const { modelId, ...toolStart } = start;
      const model = modelOrDefault(modelId);
      replyTools = await createReplyTools(ctx, {
        threadId,
        ...toolStart,
        timeZone,
        stepsTaken,
        autoApprovedCount,
      });
      const { log, fitHistory, maxSteps } = replyTools;
      const result = await chatAgent.streamText(
        ctx,
        { threadId },
        {
          promptMessageId,
          model: languageModelFor(model),
          providerOptions: gatewayOptions(model),
          // A cache breakpoint on the instructions. The tools come before
          // them in the request, so they cache too.
          instructions: {
            role: "system",
            content: replyInstructions({
              timeZone,
              now: new Date(),
              canSearchWeb,
              canSchedule: replyTools.canSchedule,
              connectorText: replyTools.connectorText,
              autoApprove: replyTools.autoApprove,
            }),
            providerOptions: CACHE_BREAKPOINT,
          },
          tools: replyTools.tools,
          toolApproval: replyTools.toolApproval,
          stopWhen: stepCountIs(maxSteps),
          // The last step can't call tools, so a reply that hits the step
          // cap or runs long still ends with text. With no active tools,
          // @ai-sdk/anthropic sends no tools and leaves tool search parts
          // out of the history. Anthropic accepts plain tool calls in
          // history without their tools. toolChoice "none" also sends no
          // tools, but keeps the search parts, which Anthropic rejects.
          prepareStep: ({ stepNumber }) =>
            stepNumber === maxSteps - 1 ||
            Date.now() - startedAt >= REPLY_TIME_LIMIT_MS
              ? { activeTools: [] }
              : {},
          onStepFinish: (step) => log.addStep(step),
          onToolExecutionEnd: (event) => log.addToolRun(event),
          onAbort: () => {
            aborted = true;
          },
        },
        {
          // more custom delta options (`true` uses defaults)
          saveStreamDeltas: { chunking: "word", throttleMs: 100 },
          // Runs once per call, on the history saved before it, so a
          // continuation runs it again. Later steps add only tools this
          // reply offers. It changes what's sent, not what's saved. The
          // second cache breakpoint goes on the last message before the
          // new prompt, so the steps of this reply and the next prompt
          // read the history from the cache. An attachment from an earlier
          // turn that the model can't read goes as a note naming it.
          contextHandler: async (
            _ctx,
            { search, recent, inputMessages, inputPrompt, existingResponses },
          ) => {
            const history = [...search, ...recent, ...inputMessages];
            return fitHistory(
              withCacheBreakpoint(
                replaceUnreadableAttachments(
                  [...history, ...inputPrompt, ...existingResponses],
                  model.reads,
                ),
                history.length - 1,
              ),
            );
          },
        },
      );
      // We need to make sure the stream finishes - by awaiting each chunk
      // or using this call to consume it all.
      await result.consumeStream();
      endedNormally = !aborted;
      ending = "returned";
    } catch (error) {
      // Deleting the thread mid-reply deletes the reply under the runner,
      // and the Agent's next save throws. There's nothing left to fail or
      // pause then. If the check itself fails, this goes on as for any
      // other failure.
      const threadDeleted = await ctx
        .runQuery(internal.chat.reply.threadExists, { threadId })
        .then((exists) => !exists)
        .catch(() => false);
      if (threadDeleted) {
        ending = undefined;
        return;
      }
      ending = "failed";
      // The Agent fails the reply it saved when the model call fails. If
      // the error came before it saved one, the client would wait 60
      // seconds for a reply that isn't coming. We rethrow the error so it
      // reaches the logs, even if saving the failed reply fails too.
      await ctx
        .runMutation(internal.chat.reply.failReplyStart, {
          threadId,
          promptMessageId,
        })
        .catch((saveError: unknown) =>
          console.error("Couldn't save the failed reply", saveError),
        );
      // The queue's next prompt would follow a broken answer, and with the
      // API down it would fail too.
      await ctx
        .runMutation(internal.chat.queue.pauseQueue, { threadId })
        .catch((pauseError: unknown) =>
          console.error("Couldn't pause the queue", pauseError),
        );
      throw error;
    } finally {
      await replyTools?.close();
      // Before the next queued prompt starts, so the reply's turn is still
      // the thread's last.
      if (ending) {
        await ctx
          .runMutation(internal.scheduledPrompts.recordRunOutcome, {
            threadId,
            promptMessageId,
            order,
            continuing,
            ending,
          })
          .catch((recordError: unknown) =>
            console.error("Couldn't record the scheduled run", recordError),
          );
        // For the sidebar and the alerts, whether the reply paused on
        // action cards or not.
        await ctx
          .runMutation(internal.chat.approval.recordPendingActions, {
            threadId,
          })
          .catch((recordError: unknown) =>
            console.error("Couldn't record the waiting cards", recordError),
          );
      }
      if (aborted) {
        await ctx.runMutation(internal.chat.stop.settleStop, {
          threadId,
          promptMessageId,
          order,
        });
      } else if (endedNormally) {
        // A queue that didn't start its next prompt and isn't paused would
        // wait with nothing to start it, and no Resume to show.
        await ctx
          .runMutation(internal.chat.send.startNextPrompt, { threadId })
          .catch(async (startError: unknown) => {
            console.error("Couldn't start the next queued prompt", startError);
            await ctx.runMutation(internal.chat.queue.pauseQueue, {
              threadId,
            });
          });
      }
    }
  },
});

const vReplyStart = v.union(
  v.null(),
  v.object({
    promptText: v.string(),
    connections: v.array(schema.doc("connections")),
    threadDefersTools: v.boolean(),
    temporary: v.boolean(),
    autoApprove: v.boolean(),
    modelId: v.string(),
  }),
);

type ReplyStart = Infer<typeof vReplyStart>;

/**
 * Everything streamReply reads before it builds tools, in one query. The
 * fields other than `modelId` go to createReplyTools as they are.
 *
 * Null if streamReply shouldn't call the model. That's when the user pressed
 * Stop before the runner started, or the prompt is gone. A regenerate or an
 * edit deletes the old prompt, so a runner left over from before it stops
 * here. A reply continuing after action cards also stops here once the user
 * has sent a new prompt. That prompt closed the turn's actions
 * (closeUnrunActions), and the reply would add an answer after it.
 *
 * Otherwise:
 * - `promptText`: the text of the prompt the reply answers, for finding its
 *   mentions. `promptMessageId` is the prompt, or the user's decisions on
 *   action cards when the reply continues. The turn's prompt is at or
 *   before it. Empty if the prompt has no text.
 * - `connections`: the thread owner's connections, tokens included, without
 *   their tool lists. The reply runs from the scheduler with no signed-in
 *   user, so the thread names the user.
 * - `threadDefersTools`: whether the thread already defers connector tools
 *   (deferThreadTools).
 * - `temporary`: whether the thread is temporary.
 * - `autoApprove`: whether the thread has auto-approve on. Never in a
 *   scheduled prompt thread, whose runs always stop on their cards (ADR
 *   0013). Read at every start, so a change counts from the next one.
 * - `modelId`: the thread's model, or the default model when the thread
 *   can't use its model anymore (resolveReplyModel). Read at every start
 *   too, so a reply continuing after action cards and a queued prompt use
 *   the model the thread has then.
 */
export const getReplyStart = internalQuery({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
    order: v.number(),
    continuing: v.boolean(),
  },
  returns: vReplyStart,
  handler: async (ctx, { threadId, promptMessageId, order, continuing }) => {
    const turn = continuing
      ? await getContinuedTurn(ctx, { threadId, promptMessageId, order })
      : await listTurnUpTo(ctx, { threadId, promptMessageId, order });
    if (!turn) return null;
    const [
      stopped,
      thread,
      deferredToolThread,
      temporaryThread,
      autoApproveThread,
      scheduledPrompt,
    ] = await Promise.all([
      getStoppedReply(ctx, threadId, order),
      getThreadMetadata(ctx, components.agent, { threadId }).catch(() => null),
      findDeferredToolThread(ctx, threadId),
      findTemporaryThread(ctx, threadId),
      findAutoApproveThread(ctx, threadId),
      findThreadScheduledPrompt(ctx, threadId),
    ]);
    if (stopped) return null;
    const prompt = turn.find((message) => message.message?.role === "user");
    const userId = thread?.userId;
    const [connections, { model }] = await Promise.all([
      userId ? readUserConnections(ctx, userId) : [],
      resolveReplyModel(ctx, { threadId, userId }),
    ]);
    return {
      promptText: prompt?.text ?? "",
      connections,
      threadDefersTools: deferredToolThread !== null,
      temporary: temporaryThread !== null,
      autoApprove: isAutoApproveOn(autoApproveThread, scheduledPrompt),
      modelId: model.id,
    };
  },
});

/** False once the thread is deleted. Throws if the lookup fails. */
export const threadExists = internalQuery({
  args: { threadId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { threadId }) => {
    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId,
    });
    return thread !== null;
  },
});

/**
 * Makes the thread defer connector tools from now on. A reply calls it when
 * the thread first crosses the tool budget (lib/replyTools.ts).
 */
export const deferThreadTools = internalMutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    if (!(await findDeferredToolThread(ctx, threadId))) {
      await ctx.db.insert("deferredToolThreads", { threadId });
    }
    return null;
  },
});

/** The thread's deferredToolThreads row, or null if it doesn't defer. */
async function findDeferredToolThread(ctx: QueryCtx, threadId: string) {
  return await ctx.db
    .query("deferredToolThreads")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .unique();
}

/**
 * Saves a failed reply to the prompt when streamReply fails before the
 * Agent saves anything for it. The thread then shows the error and
 * Regenerate, as it does when the model call fails. The message gets a
 * generic error. The error the runner hit goes to the logs only.
 *
 * Does nothing unless the prompt is still the thread's newest message. If
 * it isn't, the Agent saved the reply (and failed it itself), a regenerate
 * or an edit deleted the prompt, or the user sent a new one.
 */
export const failReplyStart = internalMutation({
  args: { threadId: v.string(), promptMessageId: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId, promptMessageId }) => {
    const { page } = await listMessages(ctx, components.agent, {
      threadId,
      paginationOpts: { numItems: 1, cursor: null },
    });
    if (page[0]?._id !== promptMessageId) return null;
    await chatAgent.saveMessage(ctx, {
      threadId,
      promptMessageId,
      message: { role: "assistant", content: [] },
      metadata: { status: "failed", error: REPLY_START_FAILED },
      skipEmbeddings: true,
    });
    return null;
  },
});
