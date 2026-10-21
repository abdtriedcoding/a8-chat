/**
 * The models a8 offers (GLOSSARY.md, ADR 0015). The list is short and kept
 * in code. A model joins it only after it's been tried with connectors and
 * action cards, and adding one takes a pull request. Every model goes
 * through Vercel AI Gateway (languageModelFor in lib/gateway.ts).
 *
 * The browser loads this module too, for the picker.
 */
import type { MessageDoc } from "@convex-dev/agent";
import type { PlanTerms } from "./billing";
import type { AttachmentKind } from "./attachments";

export type Lab = "anthropic" | "openai" | "google";

/** Each lab's name, in the order the picker groups them. */
export const LAB_NAMES: Record<Lab, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
};

export type Model = {
  /** The id a8 stores for a thread or a user. */
  id: string;
  name: string;
  lab: Lab;
  /** The model's id on AI Gateway, which a reply saves on its messages. */
  gatewayId: string;
  /** The attachments it reads. */
  reads: AttachmentKind[];
  /** How many tokens of prompt and reply it takes. */
  contextTokens: number;
  /** The plans that can use it. Pro gets every model. */
  plans: PlanTerms["name"][];
  /**
   * About how many credits one reply costs, for the picker only. Hand-set
   * for a reply of a few steps with connectors. Real charges come from each
   * reply's cost.
   */
  creditsPerReply: number;
  /** Ids its replies were saved under before, so older replies keep a label. */
  formerIds?: string[];
};

export const MODELS: Model[] = [
  {
    id: "claude-haiku-5.5",
    name: "Claude Haiku 5.5",
    lab: "anthropic",
    gatewayId: "anthropic/claude-haiku-5.5",
    reads: ["image", "pdf"],
    contextTokens: 1_000_000,
    plans: ["free", "pro"],
    creditsPerReply: 0.5,
    // The Anthropic API's id, from before replies went through the gateway.
    formerIds: ["claude-haiku-5-5"],
  },
  {
    id: "claude-sonnet-5.5",
    name: "Claude Sonnet 5.5",
    lab: "anthropic",
    gatewayId: "anthropic/claude-sonnet-5.5",
    reads: ["image", "pdf"],
    contextTokens: 1_000_000,
    plans: ["pro"],
    creditsPerReply: 10,
  },
  {
    id: "claude-opus-5.5",
    name: "Claude Opus 5.5",
    lab: "anthropic",
    gatewayId: "anthropic/claude-opus-5.5",
    reads: ["image", "pdf"],
    contextTokens: 1_000_000,
    plans: ["pro"],
    creditsPerReply: 20,
  },
  {
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    lab: "openai",
    gatewayId: "openai/gpt-6-luna",
    reads: ["image", "pdf"],
    contextTokens: 1_050_000,
    plans: ["free", "pro"],
    creditsPerReply: 0.5,
  },
  {
    id: "gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    lab: "openai",
    gatewayId: "openai/gpt-6.1-sol",
    reads: ["image", "pdf"],
    contextTokens: 1_050_000,
    plans: ["pro"],
    creditsPerReply: 10,
  },
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    lab: "google",
    gatewayId: "google/gemini-3.8-flash",
    reads: ["image", "pdf"],
    contextTokens: 1_000_000,
    plans: ["free", "pro"],
    creditsPerReply: 4,
  },
  {
    id: "gemini-4-argon",
    name: "Gemini 4 Argon",
    lab: "google",
    gatewayId: "google/gemini-4-argon",
    reads: ["image", "pdf"],
    contextTokens: 1_000_000,
    plans: ["pro"],
    creditsPerReply: 10,
  },
];

/** The default model of a user who hasn't set one. */
export const DEFAULT_MODEL_ID = "claude-haiku-5.5";

/** The model that writes thread titles, at no credit cost. */
export const TITLE_MODEL_ID = "claude-haiku-5.5";

/** The listed model with this id, or undefined if it's not on the list. */
export function findModel(id: string): Model | undefined {
  return MODELS.find((model) => model.id === id);
}

/** The listed model, or the default model for an id that's off the list. */
export function modelOrDefault(id: string | undefined): Model {
  return (id !== undefined && findModel(id)) || defaultModel();
}

/** The default model of a user who hasn't set one (DEFAULT_MODEL_ID). */
export function defaultModel(): Model {
  const model = findModel(DEFAULT_MODEL_ID);
  if (!model) throw new Error(`${DEFAULT_MODEL_ID} isn't on the model list.`);
  return model;
}

/**
 * The listed model a saved message names, by its gateway id or a former
 * id. Undefined for a model that left the list.
 */
export function findModelBySavedId(savedId: string): Model | undefined {
  return MODELS.find(
    (model) =>
      model.gatewayId === savedId || model.formerIds?.includes(savedId),
  );
}

/** The listed models of each lab, in LAB_NAMES order, for the pickers. */
export function modelsByLab(): { lab: Lab; models: Model[] }[] {
  return (Object.keys(LAB_NAMES) as Lab[]).map((lab) => ({
    lab,
    models: MODELS.filter((model) => model.lab === lab),
  }));
}

/** Whether the model is Claude, which gets Anthropic's tools and options. */
export function isClaude(model: Model): boolean {
  return model.lab === "anthropic";
}

/**
 * The model that wrote each turn's reply, by the turn's order, as a8 ids.
 * The Agent saves its model id on each reply message. `messages` come
 * newest first, as the Agent lists them, so a reply that switched models
 * after an action card gets the model it continued on. A turn whose reply
 * names a model off the list gets none.
 */
export function replyModelIds(messages: MessageDoc[]): Map<number, string> {
  const ids = new Map<number, string>();
  for (const message of messages) {
    if (message.message?.role !== "assistant" || !message.model) continue;
    if (ids.has(message.order)) continue;
    const model = findModelBySavedId(message.model);
    if (model) ids.set(message.order, model.id);
  }
  return ids;
}
