import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ConvexError } from "convex/values";
import { env } from "../_generated/server";

/**
 * Used when DEFAULT_MODEL is unset. Checked against openrouter.ai/models on
 * 2026-09-29: cheap, no expiry date, and supports tools for later weeks.
 */
export const FALLBACK_MODEL_ID = "google/gemini-3.1-flash-lite";

/** The OpenRouter model slug for the next reply. */
export function resolveModelId(): string {
  // Week 2: the thread's own model choice (threadMeta.model) goes first.
  return env.DEFAULT_MODEL ?? FALLBACK_MODEL_ID;
}

export function chatModel(modelId: string) {
  const openrouter = createOpenRouter({
    apiKey: env.OPENROUTER_API_KEY,
    // "strict" is the mode for the real OpenRouter API. The default,
    // "compatible", drops stream_options, so streamed replies report no usage.
    compatibility: "strict",
    // Attribution on the openrouter.ai dashboard (HTTP-Referer and
    // X-OpenRouter-Title headers).
    appUrl: env.SITE_URL,
    appName: "a8",
  });
  return openrouter.chat(modelId, { usage: { include: true } });
}

/** Throws before anything is saved, so a missing key never leaves a stuck reply. */
export function assertModelConfigured(): void {
  if (!env.OPENROUTER_API_KEY) {
    throw new ConvexError({
      code: "MODEL_NOT_CONFIGURED",
      message: "Chat isn't set up yet: the server has no OpenRouter API key.",
    });
  }
}
