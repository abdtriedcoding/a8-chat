// What Anthropic charges for the Claude models a8 runs, so a model call's
// cost can be worked out from its tokens (ADR 0015). Prices are in USD per
// million tokens, from Anthropic's pricing page (checked Oct 21, 2026).
import type { LanguageModelUsage } from "ai";
import type { Infer } from "convex/values";
import type { vTokenCounts } from "../schema";

type TokenPrices = {
  input: number;
  output: number;
  // A 5-minute cache write, the only kind a8 asks for (CACHE_BREAKPOINT in
  // lib/replyTools.ts). 1.25 times the input price.
  cacheWrite: number;
  // 0.1 times the input price.
  cacheRead: number;
};

type ModelPrices = TokenPrices & {
  /** Higher prices for the whole call once its prompt passes `over` tokens. */
  longPrompt?: TokenPrices & { over: number };
};

const CLAUDE_PRICES: Record<string, ModelPrices> = {
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheWrite: 0.125,
    cacheRead: 0.01,
    longPrompt: {
      over: 100_000,
      input: 0.5,
      output: 2.5,
      cacheWrite: 0.625,
      cacheRead: 0.05,
    },
  },
};

/** A model call's tokens, as a usage event records them. */
export type TokenCounts = Infer<typeof vTokenCounts>;

/** The token counts in an AI SDK usage report. Missing counts are 0. */
export function tokenCounts(usage: LanguageModelUsage): TokenCounts {
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

/** What a call to a Claude model cost, in USD, or null for a model not in the table. */
export function claudeCostUsd(model: string, tokens: TokenCounts): number | null {
  if (!Object.hasOwn(CLAUDE_PRICES, model)) return null;
  const prices = CLAUDE_PRICES[model];
  const promptTokens =
    tokens.inputTokens + tokens.cacheWriteTokens + tokens.cacheReadTokens;
  const rates =
    prices.longPrompt && promptTokens > prices.longPrompt.over
      ? prices.longPrompt
      : prices;
  return (
    (tokens.inputTokens * rates.input +
      tokens.outputTokens * rates.output +
      tokens.cacheWriteTokens * rates.cacheWrite +
      tokens.cacheReadTokens * rates.cacheRead) /
    1_000_000
  );
}
