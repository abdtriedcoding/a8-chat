// See the docs at https://docs.convex.dev/agents/getting-started
import { createAnthropic } from "@ai-sdk/anthropic";
import { Agent, type UsageHandler } from "@convex-dev/agent";
import type { ToolSet } from "ai";
import { components } from "../_generated/api";
import { env } from "../_generated/server";
import { canSearchWeb, webSearch } from "../tools/webSearch";

/**
 * The most model calls one reply makes, reached only with connector tools.
 * Each tool round trip adds one.
 */
export const MAX_REPLY_STEPS = 20;

/** The most model calls a reply without connector tools makes. */
export const MAX_STEPS_WITHOUT_CONNECTORS = 5;

/** The tools a8 offers on every reply. A tool is offered only when it's set up. */
export const nativeTools: ToolSet = canSearchWeb ? { webSearch } : {};

const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });

/**
 * The model that writes replies and thread titles. Replies need a model
 * with Anthropic's tool search (toolSearch). The tool search spike
 * (docs/connectors/tool-search-spike.md) ran on Haiku 4.5 and found it
 * searches well when the system prompt names the user's connections. Haiku
 * 5.5 is newer, so it supports tool search too.
 */
export const chatModel = anthropic("claude-haiku-5-5");

/**
 * The tool a reply that defers connector tools offers for finding them
 * (ADR 0006). It's Anthropic's native BM25 search, which matches
 * plain-language queries.
 */
export const toolSearch = anthropic.tools.toolSearchBm25_20251119();

/** Logs a model call's token usage. Replies and titles both log here. */
export const logUsage: UsageHandler = async (
  _ctx,
  { userId, threadId, provider, model, usage },
) => {
  // Stage 1 only logs usage. Billing and limits build on this later.
  console.log("usage", {
    userId,
    threadId,
    provider,
    model,
    inputTokens: usage.inputTokens,
    // The part of inputTokens read from or written to Anthropic's prompt
    // cache (streamReply's cache breakpoints).
    cacheReadTokens: usage.inputTokenDetails.cacheReadTokens,
    cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens,
    outputTokens: usage.outputTokens,
  });
};

// Instructions, tools and the step limit are set for each reply
// (streamReply). The instructions carry the user's date, and the tools
// depend on the user's connections.
export const chatAgent = new Agent(components.agent, {
  name: "a8",
  languageModel: chatModel,
  usageHandler: logUsage,
});
