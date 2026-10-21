/**
 * The models a8 offers (GLOSSARY.md, ADR 0017): every chat model on Vercel
 * AI Gateway that can call tools. scripts/sync-models.ts copies them from
 * the gateway into lib/gatewayModels.ts, and a model joins or leaves the
 * list when someone runs it and merges the diff. Every model goes through
 * the gateway (languageModelFor in lib/gateway.ts).
 *
 * The browser loads this module too, for the picker.
 */
import type { MessageDoc } from "@convex-dev/agent";
import type { PlanTerms } from "./billing";
import type { AttachmentKind } from "./attachments";
import { CONNECTOR_CHECKS } from "./connectorChecks";
import { GATEWAY_LABS, GATEWAY_MODELS, SYNCED_ON } from "./gatewayModels";

/** A lab's id on AI Gateway, like "anthropic" or "openai". */
export type Lab = string;

export type PlanName = PlanTerms["name"];

/** A lab with models on the list, in the picker's order. */
export type LabInfo = {
  id: Lab;
  name: string;
  /** Whether public/labs has its logo. */
  logo: boolean;
};

export const LABS: LabInfo[] = GATEWAY_LABS;

export type Model = {
  /** The id a8 stores for a thread or a user: the gateway id after the lab. */
  id: string;
  name: string;
  lab: Lab;
  /** The model's id on AI Gateway, which a reply saves on its messages. */
  gatewayId: string;
  /** One sentence from the gateway on what the model is for. */
  description: string;
  /** The attachments it reads. */
  reads: AttachmentKind[];
  /** How many tokens of prompt and reply it takes. */
  contextTokens: number;
  /** Whether the gateway tags it as a reasoning model. */
  reasoning: boolean;
  /** Whether the gateway tags it as fast. */
  fast: boolean;
  /**
   * Whether it passed a connector check (lib/connectorChecks.ts, ADR 0018).
   * False for a model that failed one or was never checked.
   */
  worksWithConnectors: boolean;
  /** Whether it came out within NEW_FOR_DAYS of the last sync. */
  isNew: boolean;
  /** The plans that can use it. Pro gets every model. */
  plans: PlanName[];
  /**
   * About how many credits one reply costs, for the picker only
   * (estimateCredits). Real charges come from each reply's cost.
   */
  creditsPerReply: number;
  /** Ids its replies were saved under before, so older replies keep a label. */
  formerIds?: string[];
};

/**
 * The tokens of a typical reply of a few steps with connectors, for
 * creditsPerReply. They match the hand-set estimates the list had before
 * it followed the gateway.
 */
const TYPICAL_REPLY = { inputTokens: 30_000, outputTokens: 4_000 };

/** The most credits a typical reply on a Free model costs. */
const FREE_MAX_CREDITS_PER_REPLY = 5;

/** How long a model shows as new after it comes out. */
const NEW_FOR_DAYS = 45;

/** Ids a model's replies were saved under before, by a8 id. */
const FORMER_IDS: Record<string, string[]> = {
  // The Anthropic API's id, from before replies went through the gateway.
  "claude-haiku-5.5": ["claude-haiku-5-5"],
};

/**
 * The models a8 highlights, in the picker's Featured tab. Ids off the list
 * are skipped, so a model the gateway drops leaves the tab too.
 */
export const FEATURED_MODEL_IDS = [
  "claude-haiku-5.5",
  "claude-sonnet-5.5",
  "claude-opus-5.5",
  "gpt-6-luna",
  "gpt-6-sol",
  "gpt-6.1-sol",
  "gpt-6-astra",
  "gemini-3.8-flash",
  "gemini-4-argon",
  "grok-4.7",
  "deepseek-v4-pro",
  "kimi-k3",
  "glm-5.3",
  "qwen3.8-max",
];

/** About how many credits a typical reply costs at these prices. */
function estimateCredits(usdPerMillionTokens: {
  input: number;
  output: number;
}): number {
  const usd =
    (TYPICAL_REPLY.inputTokens * usdPerMillionTokens.input +
      TYPICAL_REPLY.outputTokens * usdPerMillionTokens.output) /
    1_000_000;
  // One credit is one US cent (lib/credits.ts, which the browser can't load).
  return usd * 100;
}

const newSince =
  Date.parse(SYNCED_ON) - NEW_FOR_DAYS * 24 * 60 * 60 * 1000;

export const MODELS: Model[] = GATEWAY_MODELS.map((entry) => {
  const id = entry.gatewayId.slice(entry.gatewayId.indexOf("/") + 1);
  const creditsPerReply = estimateCredits(entry.usdPerMillionTokens);
  return {
    id,
    name: entry.name,
    lab: entry.lab,
    gatewayId: entry.gatewayId,
    description: entry.description,
    reads: entry.reads,
    contextTokens: entry.contextTokens,
    reasoning: entry.reasoning,
    fast: entry.fast,
    worksWithConnectors: CONNECTOR_CHECKS[entry.gatewayId]?.passed === true,
    isNew: entry.released !== null && Date.parse(entry.released) >= newSince,
    plans:
      creditsPerReply <= FREE_MAX_CREDITS_PER_REPLY
        ? ["free", "pro"]
        : ["pro"],
    creditsPerReply,
    formerIds: FORMER_IDS[id],
  };
});

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

/**
 * Whether a user on `plan` can use the model. `plan` is null when billing
 * is off, and then every listed model is open.
 */
export function planIncludes(plan: PlanName | null, model: Model): boolean {
  return plan === null || model.plans.includes(plan);
}

/**
 * DEFAULT_MODEL_ID when it's on Free, or else the first Free model on the
 * list. A reply falls back to it when the user's default model isn't on
 * their plan either.
 */
export function firstFreeModel(): Model {
  const fallback = defaultModel();
  if (fallback.plans.includes("free")) return fallback;
  const model = MODELS.find((entry) => entry.plans.includes("free"));
  if (!model) throw new Error("The model list has no Free model.");
  return model;
}

/** The lab's name, or its id for a lab off the list. */
export function labName(lab: Lab): string {
  return LABS.find((entry) => entry.id === lab)?.name ?? lab;
}

/** The listed models of each lab, in LABS order, for the pickers. */
export function modelsByLab(): { lab: LabInfo; models: Model[] }[] {
  return LABS.map((lab) => ({
    lab,
    models: MODELS.filter((model) => model.lab === lab.id),
  }));
}

/** The listed models of FEATURED_MODEL_IDS, in its order. */
export function featuredModels(): Model[] {
  return FEATURED_MODEL_IDS.flatMap((id) => findModel(id) ?? []);
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
