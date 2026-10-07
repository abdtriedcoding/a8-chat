// See the docs at https://docs.convex.dev/agents/getting-started
import { createAnthropic } from "@ai-sdk/anthropic";
import { Agent, stepCountIs, type UsageHandler } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { env } from "../_generated/server";
import { canSearchWeb } from "../lib/searchWeb";
import { webSearch } from "./webSearch";

/** The most model calls one reply makes. Each tool round trip adds one. */
export const MAX_REPLY_STEPS = 5;

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

// Instructions are set for each reply (streamReply), since they carry the
// user's date. A tool is registered only when it's set up.
export const chatAgent = new Agent(components.agent, {
  name: "a8",
  languageModel: chatModel,
  tools: canSearchWeb ? { webSearch } : {},
  stopWhen: stepCountIs(MAX_REPLY_STEPS),
  usageHandler: logUsage,
});
