/**
 * Prices what a reply or a title used and sends it to the cost recorder
 * (record in convex/usage.ts). Claude calls are priced from Anthropic's
 * token prices (lib/modelPrices.ts), and a web search costs one credit.
 */
import type { UsageHandler } from "@convex-dev/agent";
import type {
  FunctionArgs,
  GenericActionCtx,
  GenericDataModel,
} from "convex/server";
import type { Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { vUsageKind } from "../schema";
import { billingEnabled } from "./billing";
import { CREDITS_PER_USD } from "./credits";
import { claudeCostUsd, tokenCounts } from "./modelPrices";

// Replies, titles and the web search tool each pass a different action ctx.
type RecorderCtx = Pick<GenericActionCtx<GenericDataModel>, "runMutation">;

type ModelUsage = Parameters<UsageHandler>[1];

type UsageEvent = FunctionArgs<typeof internal.usage.record>;

/** What a successful web search costs, in credits. */
const WEB_SEARCH_CREDITS = 1;

/**
 * Logs a model call's tokens and records its cost. `kind` is "title" for a
 * thread title, whose cost goes to the day's spend and not the user's
 * credits.
 */
export async function recordModelUsage(
  ctx: RecorderCtx,
  kind: Exclude<Infer<typeof vUsageKind>, "webSearch">,
  { userId, threadId, provider, model, usage }: ModelUsage,
): Promise<void> {
  const tokens = tokenCounts(usage);
  console.log("usage", { userId, threadId, kind, provider, model, ...tokens });
  if (!billingEnabled) return;
  const costUsd = claudeCostUsd(model, tokens);
  if (costUsd === null) {
    console.error(`No prices for ${model}, so its cost isn't recorded.`);
    return;
  }
  await sendToRecorder(ctx, { userId, threadId, kind, model, tokens, costUsd });
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

// A failed write is logged, not thrown, so it never stops a reply that has
// started. A reply that starts always finishes.
async function sendToRecorder(ctx: RecorderCtx, event: UsageEvent) {
  try {
    await ctx.runMutation(internal.usage.record, event);
  } catch (error) {
    console.error("Couldn't record usage", event, error);
  }
}
