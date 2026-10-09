// See the docs at https://docs.convex.dev/agents/getting-started
import { createAnthropic } from "@ai-sdk/anthropic";
import { Agent, type UsageHandler } from "@convex-dev/agent";
import type { ToolSet } from "ai";
import { components } from "../_generated/api";
import { env } from "../_generated/server";
import { canSearchWeb } from "../lib/searchWeb";
import { webSearch } from "./webSearch";

/**
 * The most model calls one reply makes, reached only with connector tools.
 * Each tool round trip adds one.
 */
export const MAX_REPLY_STEPS = 20;

/** The most model calls a reply without connector tools makes. */
export const MAX_STEPS_WITHOUT_CONNECTORS = 5;

/** The tools a8 offers on every reply. A tool is offered only when it's set up. */
export const nativeTools: ToolSet = canSearchWeb ? { webSearch } : {};

/** The model that writes replies and thread titles. */
export const chatModel = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(
  "claude-haiku-4-5-20251001",
);

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
