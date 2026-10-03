// See the docs at https://docs.convex.dev/agents/getting-started
import { createAnthropic } from "@ai-sdk/anthropic";
import { Agent, stepCountIs } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { env } from "../_generated/server";

/** The most model calls one reply makes. Each tool round trip adds one. */
export const MAX_REPLY_STEPS = 5;

// Instructions are set for each reply (streamReply), since they carry the
// user's date. Tools go here once they're set up.
export const chatAgent = new Agent(components.agent, {
  name: "a8",
  languageModel: createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(
    "claude-haiku-4-5-20251001",
  ),
  stopWhen: stepCountIs(MAX_REPLY_STEPS),
  usageHandler: async (_ctx, { userId, threadId, provider, model, usage }) => {
    // Stage 1 only logs usage. Billing and limits build on this later.
    console.log("usage", {
      userId,
      threadId,
      provider,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
  },
});
