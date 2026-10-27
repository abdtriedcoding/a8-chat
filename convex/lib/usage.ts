/**
 * Sends what a reply, a title, a web search or a dictation cost to the cost
 * recorder (record in convex/usage.ts). A model call costs what AI Gateway
 * reports for its generation (ADR 0015), and a web search or a dictation
 * token costs one credit. A
 * reply step the user stopped costs the same, and an estimate only when
 * the gateway can't say (recordStoppedStep).
 */
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import type { UsageHandler } from "@convex-dev/agent";
import { wrapLanguageModel, type LanguageModelUsage } from "ai";
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

// Replies, titles and the web search tool each pass a different action ctx,
// and dictation passes a mutation ctx.
type RecorderCtx = Pick<GenericActionCtx<GenericDataModel>, "runMutation">;

type ModelUsage = Parameters<UsageHandler>[1];

type UsageEvent = FunctionArgs<typeof internal.usage.record>;

/** A model call's tokens, as a usage event records them. */
type TokenCounts = Infer<typeof vTokenCounts>;

/** What a successful web search costs, in credits. */
const WEB_SEARCH_CREDITS = 1;

/**
 * What a dictation token costs, in credits. a8 can't see how long a
 * dictation runs, or whether a warm-up's socket is ever used (ADR 0012), so
 * each token costs the same. One credit is about 1.3 minutes of Flux.
 */
const DICTATION_CREDITS = 1;

/**
 * How many characters count as a token in an estimate, as in
 * estimateToolTokens.
 */
const CHARS_PER_TOKEN = 4;

/**
 * What an attached image or PDF counts as in an estimate, in tokens. The
 * request holds a file's URL, not its size. Anthropic counts an image at up
 * to about 1,600 tokens, and a PDF page at 1,500 to 3,000, so a PDF counts
 * as five pages at 2,000.
 */
const IMAGE_TOKENS = 1_600;
const PDF_TOKENS = 10_000;

/**
 * How fast a reasoning model counts as writing tokens it doesn't stream,
 * for an estimate. Reasoning on OpenAI and Grok models, and on Claude
 * without a summary, streams nothing. GPT-5.5 wrote 43 tokens a second in
 * testing (Oct 26, 2026).
 */
const HIDDEN_REASONING_TOKENS_PER_SECOND = 40;

/** The response header where AI Gateway names a model call's generation. */
const GENERATION_ID_HEADER = "x-generation-id";

/**
 * Logs a model call's tokens and has its cost recorded once the gateway
 * reports it (scheduleCostLookup in convex/usage.ts). `kind` is "title"
 * for a thread title, whose cost goes to the day's spend and not the
 * user's credits.
 */
export async function recordModelUsage(
  ctx: RecorderCtx,
  kind: Exclude<Infer<typeof vUsageKind>, "webSearch" | "dictation">,
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
  await scheduleCostLookup(ctx, {
    generationId,
    event: { userId, threadId, kind, model, tokens },
  });
}

/**
 * A reply step's model call while it runs, from trackModelCalls. The
 * Agent records a step's usage only once the step finishes, so a step the
 * user stopped is recorded from this (recordStoppedStep).
 */
export type ModelCall = {
  /** The gateway's generation, once the response starts. */
  generationId: string | undefined;
  /**
   * About how many tokens the call sent: the messages and tool definitions,
   * 4 characters to a token, plus IMAGE_TOKENS or PDF_TOKENS a file.
   */
  inputTokens: number;
  /** The characters of text, reasoning and tool input streamed back. */
  outputChars: number;
  /** When the response started. */
  respondedAt: number | undefined;
};

/**
 * The model, calling `onCall` as each streamed call starts. The call it
 * gets fills in as the response arrives. `onCall` gets undefined when a
 * call fails before its response starts, as when the SDK retries it. A
 * call made after a Stop, which never goes out, isn't tracked.
 */
export function trackModelCalls(
  model: LanguageModelV4,
  onCall: (call: ModelCall | undefined) => void,
): LanguageModelV4 {
  return wrapLanguageModel({
    model,
    middleware: {
      wrapStream: async ({ doStream, params }) => {
        if (params.abortSignal?.aborted) return await doStream();
        const call: ModelCall = {
          generationId: undefined,
          inputTokens: estimateInputTokens(params),
          outputChars: 0,
          respondedAt: undefined,
        };
        onCall(call);
        let result;
        try {
          result = await doStream();
        } catch (error) {
          // A call the Stop cut off may have reached the model. One that
          // failed on its own costs nothing.
          if (!params.abortSignal?.aborted) onCall(undefined);
          throw error;
        }
        call.generationId = result.response?.headers?.[GENERATION_ID_HEADER];
        call.respondedAt = Date.now();
        const counter = new TransformStream<
          LanguageModelV4StreamPart,
          LanguageModelV4StreamPart
        >({
          transform(part, controller) {
            if (
              part.type === "text-delta" ||
              part.type === "reasoning-delta" ||
              part.type === "tool-input-delta"
            ) {
              call.outputChars += part.delta.length;
            }
            controller.enqueue(part);
          },
        });
        return { ...result, stream: result.stream.pipeThrough(counter) };
      },
    },
  });
}

/**
 * Records a reply step the user stopped before it finished, so a Stop just
 * before the end doesn't get the step for free. The gateway finishes a
 * generation after the stop and bills all of it, so the step costs what the
 * gateway reports for it, like a step that finished. Before the response
 * starts there's no generation to look up, and the step costs an estimate
 * at the model's listed prices (estimateStoppedStep). So does one whose
 * cost the gateway never reports, or reports as free because a BYOK key
 * paid for it (recordGenerationCost).
 */
export async function recordStoppedStep(
  ctx: RecorderCtx,
  {
    userId,
    threadId,
    model,
    call,
  }: {
    userId: string | undefined;
    threadId: string;
    model: Model;
    call: ModelCall;
  },
): Promise<void> {
  const { tokens, costUsd } = estimateStoppedStep(model, call);
  const { generationId } = call;
  console.log("usage", {
    userId,
    threadId,
    kind: "replyStep",
    model: model.gatewayId,
    ...tokens,
    generationId,
    estimated: true,
  });
  if (!billingEnabled) return;
  const event = {
    userId,
    threadId,
    kind: "replyStep" as const,
    model: model.gatewayId,
    tokens,
  };
  // If the lookup can't be scheduled, the estimate is recorded now.
  const scheduled =
    generationId !== undefined &&
    (await scheduleCostLookup(ctx, {
      generationId,
      event,
      estimatedCostUsd: costUsd,
    }));
  if (!scheduled) await sendToRecorder(ctx, { ...event, costUsd });
}

/**
 * What a stopped step cost by estimate, at the model's listed prices.
 * Output counts the characters it streamed, 4 to a token. On a reasoning
 * model, it counts at least HIDDEN_REASONING_TOKENS_PER_SECOND for as long
 * as the response ran, since hidden reasoning streams nothing.
 */
function estimateStoppedStep(model: Model, call: ModelCall) {
  const streamedTokens = Math.ceil(call.outputChars / CHARS_PER_TOKEN);
  const responseSeconds =
    call.respondedAt === undefined ? 0 : (Date.now() - call.respondedAt) / 1000;
  const outputTokens = model.reasoning
    ? Math.max(
        streamedTokens,
        Math.ceil(responseSeconds * HIDDEN_REASONING_TOKENS_PER_SECOND),
      )
    : streamedTokens;
  const tokens: TokenCounts = {
    inputTokens: call.inputTokens,
    outputTokens,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  };
  const { input, output } = model.usdPerMillionTokens;
  const costUsd =
    (tokens.inputTokens * input + tokens.outputTokens * output) / 1_000_000;
  return { tokens, costUsd };
}

/** A model call's input tokens, as ModelCall.inputTokens counts them. */
function estimateInputTokens({ prompt, tools }: LanguageModelV4CallOptions) {
  let fileTokens = 0;
  // A file in a message or a tool result goes as its URL or its bytes,
  // neither of which says how many tokens it takes. Inline text counts as
  // text.
  const json = JSON.stringify({ prompt, tools }, (_key, value: unknown) => {
    if (!isFilePart(value) || value.data.type === "text") return value;
    fileTokens += value.mediaType.startsWith("image")
      ? IMAGE_TOKENS
      : PDF_TOKENS;
    return undefined;
  });
  return Math.ceil(json.length / CHARS_PER_TOKEN) + fileTokens;
}

/** Whether a value is a file part of a prompt or a tool result. */
function isFilePart(
  value: unknown,
): value is { type: "file"; mediaType: string; data: { type: string } } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "file" &&
    "mediaType" in value &&
    typeof value.mediaType === "string" &&
    "data" in value &&
    typeof value.data === "object" &&
    value.data !== null
  );
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

/** Records one dictation token that Deepgram granted (convex/dictation.ts). */
export async function recordDictation(
  ctx: RecorderCtx,
  userId: string,
): Promise<void> {
  if (!billingEnabled) return;
  await sendToRecorder(ctx, {
    userId,
    kind: "dictation",
    costUsd: DICTATION_CREDITS / CREDITS_PER_USD,
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

/**
 * Schedules the cost lookup of a model call (scheduleCostLookup in
 * convex/usage.ts). False if it couldn't. Like a failed write, a failed
 * lookup is logged, not thrown.
 */
async function scheduleCostLookup(
  ctx: RecorderCtx,
  args: FunctionArgs<typeof internal.usage.scheduleCostLookup>,
): Promise<boolean> {
  try {
    await ctx.runMutation(internal.usage.scheduleCostLookup, args);
    return true;
  } catch (error) {
    console.error("Couldn't look up the cost", args.generationId, error);
    return false;
  }
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
