// Every model goes through Vercel AI Gateway, Claude included (ADR 0015).
// AI_GATEWAY_API_KEY is required, so a deployment without it fails to
// deploy.
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import { createGateway } from "ai";
import { env } from "../_generated/server";
import { isClaude, type Model } from "./models";

export const gateway = createGateway({ apiKey: env.AI_GATEWAY_API_KEY });

/** The language model for a model on the list (lib/models.ts). */
export function languageModelFor(model: Model) {
  return gateway(model.gatewayId);
}

/**
 * The gateway's options for a call to the model, for `providerOptions`. A
 * Claude request goes to Anthropic only, so Anthropic's tool search and
 * cache breakpoints reach it. Other models get the gateway's automatic
 * caching, which caches where the lab supports it. The gateway's model
 * fallbacks stay off for every model, since a8 never moves a reply to
 * another model.
 */
export function gatewayOptions(model: Model): ProviderOptions {
  return isClaude(model)
    ? { gateway: { only: ["anthropic"] } }
    : { gateway: { caching: "auto" } };
}
