import { Agent, type ProviderMetadata } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { chatModel, resolveModelId } from "./models";

// No "use node": the Agent and the OpenRouter provider only need fetch,
// which the default Convex runtime has.
export const chatAgent = new Agent(components.agent, {
  name: "a8",
  // The default only. streamReply passes the model on every call, so a
  // changed DEFAULT_MODEL applies to the next reply. It also passes the
  // instructions, built fresh for each reply (convex/lib/reply.ts).
  languageModel: chatModel(resolveModelId()),
  usageHandler: async (
    _ctx,
    { userId, threadId, provider, model, usage, providerMetadata },
  ) => {
    // Stage 1 only logs usage. Billing and limits build on this later.
    console.log("usage", {
      userId,
      threadId,
      provider,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: openRouterCost(providerMetadata),
    });
  },
});

/**
 * The request's cost in USD, from OpenRouter's usage accounting. Undefined
 * for Anthropic, whose API reports tokens but not cost.
 */
function openRouterCost(
  providerMetadata: ProviderMetadata | undefined,
): number | undefined {
  const usage = providerMetadata?.openrouter?.usage;
  if (usage && typeof usage === "object" && !Array.isArray(usage)) {
    const cost = usage.cost;
    if (typeof cost === "number") return cost;
  }
  return undefined;
}
