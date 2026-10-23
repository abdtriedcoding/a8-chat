/**
 * Sends what a reply, a title or a web search cost to the cost recorder
 * (record in convex/usage.ts). A model call costs what AI Gateway reports
 * for its generation (ADR 0015), and a web search costs one credit. A
 * reply step the user stopped costs an estimate (recordEstimatedUsage).
 */
import type { UsageHandler } from "@convex-dev/agent";
import type { LanguageModelUsage } from "ai";
import type {
  FunctionArgs,
  GenericActionCtx,
  GenericDataModel,
} from "convex/server";
import type { Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { vTokenCounts, vUsageKind } from "../schema";
import { billingEnabled } from "./billing";
import { CREDITS_PER_USD } from "./credits";
import type { Model } from "./models";

// Replies, titles and the web search tool each pass a different action ctx.
type RecorderCtx = Pick<GenericActionCtx<GenericDataModel>, "runMutation">;

type ModelUsage = Parameters<UsageHandler>[1];

type UsageEvent = FunctionArgs<typeof internal.usage.record>;

/** A model call's tokens, as a usage event records them. */
type TokenCounts = Infer<typeof vTokenCounts>;

/** What a successful web search costs, in credits. */
const WEB_SEARCH_CREDITS = 1;

/** The least a step the user stopped costs, in credits. */
const MIN_STOPPED_STEP_CREDITS = 1;

/**
 * Logs a model call's tokens and has its cost recorded once the gateway
 * reports it (scheduleCostLookup in convex/usage.ts). `kind` is "title"
 * for a thread title, whose cost goes to the day's spend and not the
 * user's credits.
 */
export async function recordModelUsage(
  ctx: RecorderCtx,
  kind: Exclude<Infer<typeof vUsageKind>, "webSearch">,
  { userId, threadId, provider, model, usage, providerMetadata }: ModelUsage,
): Promise<void> {
  const tokens = tokenCounts(usage);
  console.log("usage", { userId, threadId, kind, provider, model, ...tokens });
  if (!billingEnabled) return;
  const generationId = providerMetadata?.gateway?.generationId;
  if (typeof generationId !== "string") {
    console.error(`No generation ID for ${model}, so its cost isn't recorded.`);
    return;
  }
  // Like a failed write, a failed lookup is logged, not thrown.
  try {
    await ctx.runMutation(internal.usage.scheduleCostLookup, {
      generationId,
      event: { userId, threadId, kind, model, tokens },
    });
  } catch (error) {
    console.error("Couldn't look up the cost", generationId, error);
  }
}

/**
 * Records a reply step the user stopped before it finished. The Agent
 * records a step's usage only once the step finishes, so without this a
 * Stop just before the end would get the step for free. The cost is an
 * estimate at the model's listed prices: `input` (what the step sent) and
 * the characters it streamed back count 4 characters as a token, as in
 * estimateToolTokens. A started step costs at least one credit.
 */
export async function recordEstimatedUsage(
  ctx: RecorderCtx,
  {
    userId,
    threadId,
    model,
    input,
    outputChars,
  }: {
    userId: string | undefined;
    threadId: string;
    model: Model;
    input: unknown;
    outputChars: number;
  },
): Promise<void> {
  const tokens: TokenCounts = {
    inputTokens: Math.ceil(JSON.stringify(input).length / 4),
    outputTokens: Math.ceil(outputChars / 4),
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  };
  console.log("usage", {
    userId,
    threadId,
    kind: "replyStep",
    model: model.gatewayId,
    ...tokens,
    estimated: true,
  });
  if (!billingEnabled) return;
  const { input: inputRate, output: outputRate } = model.usdPerMillionTokens;
  const costUsd =
    (tokens.inputTokens * inputRate + tokens.outputTokens * outputRate) /
    1_000_000;
  await sendToRecorder(ctx, {
    userId,
    threadId,
    kind: "replyStep",
    model: model.gatewayId,
    tokens,
    costUsd: Math.max(costUsd, MIN_STOPPED_STEP_CREDITS / CREDITS_PER_USD),
  });
}

/** Records one successful web search. A failed one costs nothing. */
export async function recordWebSearch(
  ctx: RecorderCtx,
  userId: string | undefined,
  threadId: string | undefined,
): Promise<void> {
  if (!billingEnabled) return;
  await sendToRecorder(ctx, {
    userId,
    threadId,
    kind: "webSearch",
    costUsd: WEB_SEARCH_CREDITS / CREDITS_PER_USD,
  });
}

/** The token counts in an AI SDK usage report. Missing counts are 0. */
function tokenCounts(usage: LanguageModelUsage): TokenCounts {
  const cacheReadTokens = usage.inputTokenDetails.cacheReadTokens ?? 0;
  const cacheWriteTokens = usage.inputTokenDetails.cacheWriteTokens ?? 0;
  return {
    inputTokens:
      usage.inputTokenDetails.noCacheTokens ??
      Math.max(0, (usage.inputTokens ?? 0) - cacheReadTokens - cacheWriteTokens),
    outputTokens: usage.outputTokens ?? 0,
    cacheWriteTokens,
    cacheReadTokens,
  };
}

// A failed write is logged, not thrown, so it never stops a reply that has
// started. A reply that starts always finishes.
async function sendToRecorder(ctx: RecorderCtx, event: UsageEvent) {
  try {
    await ctx.runMutation(internal.usage.record, event);
  } catch (error) {
    console.error("Couldn't record usage", event, error);
  }
}
