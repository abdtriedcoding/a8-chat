import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ConvexError } from "convex/values";
import { env } from "../_generated/server";

/*
 * A model ID names its provider:
 * - "anthropic:<model>" calls the Anthropic API directly, e.g.
 *   "anthropic:claude-haiku-4-5-20251001".
 * - Anything else is an OpenRouter slug, e.g. "google/gemini-3.1-flash-lite".
 *   "openrouter:<slug>" also works. Bare slugs stay the default because
 *   OpenRouter is the long-term, any-model path.
 *
 * DEFAULT_MODEL picks the model, so switching providers is an env change
 * (set the provider's key, then DEFAULT_MODEL), not a code change.
 */

const providers = {
  openrouter: {
    label: "OpenRouter",
    apiKey: () => env.OPENROUTER_API_KEY,
    languageModel: (model: string) =>
      createOpenRouter({
        apiKey: env.OPENROUTER_API_KEY,
        // "strict" is the mode for the real OpenRouter API. The default,
        // "compatible", drops stream_options, so streamed replies report
        // no usage.
        compatibility: "strict",
        // Attribution on the openrouter.ai dashboard (HTTP-Referer and
        // X-OpenRouter-Title headers).
        appUrl: env.SITE_URL,
        appName: "a8",
      }).chat(model, { usage: { include: true } }),
  },
  anthropic: {
    label: "Anthropic",
    apiKey: () => env.ANTHROPIC_API_KEY,
    languageModel: (model: string) =>
      createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(model),
  },
} satisfies Record<
  string,
  {
    label: string;
    apiKey: () => string | undefined;
    languageModel: (model: string) => LanguageModelV4;
  }
>;

type ProviderName = keyof typeof providers;

/**
 * Used when DEFAULT_MODEL is unset. Checked against openrouter.ai/models on
 * 2026-09-29: cheap, no expiry date, and supports tools for later weeks.
 */
export const FALLBACK_MODEL_ID = "google/gemini-3.1-flash-lite";

/** The model ID for the next reply. */
export function resolveModelId(): string {
  // Week 2: the thread's own model choice (threadMeta.model) goes first.
  return env.DEFAULT_MODEL ?? FALLBACK_MODEL_ID;
}

/** Splits a model ID into its provider and that provider's own model name. */
export function parseModelId(modelId: string): {
  provider: ProviderName;
  model: string;
} {
  const sep = modelId.indexOf(":");
  const prefix = modelId.slice(0, sep);
  // OpenRouter slugs can contain ":" too ("vendor/model:free"), so only a
  // known provider name counts as a prefix.
  if (sep > 0 && Object.hasOwn(providers, prefix)) {
    return { provider: prefix as ProviderName, model: modelId.slice(sep + 1) };
  }
  return { provider: "openrouter", model: modelId };
}

export function chatModel(modelId: string): LanguageModelV4 {
  const { provider, model } = parseModelId(modelId);
  return providers[provider].languageModel(model);
}

/**
 * Throws when the model's provider has no API key. Callers run it before
 * saving anything, so a missing key never leaves a stuck reply.
 */
export function assertModelConfigured(
  modelId: string = resolveModelId(),
): void {
  const provider = providers[parseModelId(modelId).provider];
  if (!provider.apiKey()) {
    throw new ConvexError({
      code: "MODEL_NOT_CONFIGURED",
      message: `Chat isn't set up yet: the server has no ${provider.label} API key.`,
    });
  }
}
