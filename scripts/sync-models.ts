/**
 * Rewrites a8's model list from AI Gateway's (ADR 0017). Fetches the
 * gateway's public model list, keeps every chat model a8 can reply with,
 * and writes them to convex/lib/gatewayModels.ts. Also saves each lab's
 * logo from models.dev to public/labs. Run it, read the diff, and open a
 * pull request. Needs no key.
 *
 *   bun scripts/sync-models.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
const LOGO_URL = (name: string) => `https://models.dev/logos/${name}.svg`;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = join(ROOT, "convex/lib/gatewayModels.ts");
const LOGO_DIR = join(ROOT, "public/labs");

/**
 * The fewest tokens of context a model needs. A reply sends a8's
 * instructions, the connector tools and up to 60,000 tokens of history
 * (HISTORY_BUDGET_TOKENS in convex/lib/toolLoading.ts).
 */
const MIN_CONTEXT_TOKENS = 64_000;

/**
 * The labs a8 names, in the picker's order, with their logo's name on
 * models.dev. A lab missing here goes after these, by its id, with a
 * letter for a logo.
 */
const LABS: { id: string; name: string; logo?: string }[] = [
  { id: "anthropic", name: "Anthropic", logo: "anthropic" },
  { id: "openai", name: "OpenAI", logo: "openai" },
  { id: "google", name: "Google", logo: "google" },
  { id: "spacexai", name: "SpaceXAI", logo: "xai" },
  { id: "deepseek", name: "DeepSeek", logo: "deepseek" },
  { id: "meta", name: "Meta", logo: "meta" },
  { id: "mistral", name: "Mistral", logo: "mistral" },
  { id: "alibaba", name: "Qwen", logo: "alibaba" },
  { id: "moonshotai", name: "Moonshot AI", logo: "moonshotai" },
  { id: "zai", name: "Z.ai", logo: "zai" },
  { id: "minimax", name: "MiniMax", logo: "minimax" },
  { id: "xiaomi", name: "Xiaomi", logo: "xiaomi" },
  { id: "amazon", name: "Amazon", logo: "nova" },
  { id: "nvidia", name: "NVIDIA", logo: "nvidia" },
  { id: "cohere", name: "Cohere", logo: "cohere" },
  { id: "bytedance", name: "ByteDance" },
  { id: "tencent", name: "Tencent" },
  { id: "inception", name: "Inception", logo: "inception" },
  { id: "stepfun", name: "StepFun", logo: "stepfun" },
  { id: "meituan", name: "Meituan", logo: "longcat" },
  { id: "inclusionai", name: "inclusionAI" },
  { id: "arcee-ai", name: "Arcee AI", logo: "arcee" },
  { id: "liquid", name: "Liquid AI", logo: "liquid" },
  { id: "poolside", name: "Poolside", logo: "poolside" },
  { id: "reflection", name: "Reflection AI", logo: "reflection" },
  { id: "sakana", name: "Sakana AI" },
  { id: "thinkingmachines", name: "Thinking Machines", logo: "thinkingmachines" },
  { id: "fireworks", name: "Fireworks AI", logo: "fireworks-ai" },
  { id: "perplexity", name: "Perplexity", logo: "perplexity" },
  { id: "callstack", name: "Callstack" },
  { id: "interfaze", name: "Interfaze" },
  { id: "mixedbread", name: "Mixedbread" },
  { id: "quiverai", name: "QuiverAI" },
  { id: "stealth", name: "Stealth" },
];

/** The fields of a gateway model this script reads. */
type GatewayEntry = {
  id: string;
  owned_by: string;
  name: string;
  description?: string;
  context_window?: number;
  type: string;
  released?: number;
  tags?: string[];
  modalities?: { input?: string[] };
  pricing?: { input?: string; output?: string };
};

const response = await fetch(MODELS_URL);
if (!response.ok) throw new Error(`${MODELS_URL} answered ${response.status}.`);
const { data } = (await response.json()) as { data: GatewayEntry[] };

const entries = data.filter(
  (entry) =>
    entry.type === "language" &&
    // Every reply offers tools: connectors, web search, scheduled prompts.
    entry.tags?.includes("tool-use") &&
    // Batch models answer later through a separate API, not in a chat.
    !entry.id.endsWith("-batch") &&
    (entry.context_window ?? 0) >= MIN_CONTEXT_TOKENS &&
    entry.pricing?.input !== undefined &&
    entry.pricing.output !== undefined,
);

const labOrder = new Map(LABS.map((lab, index) => [lab.id, index]));
entries.sort(
  (a, b) =>
    (labOrder.get(a.owned_by) ?? LABS.length) -
      (labOrder.get(b.owned_by) ?? LABS.length) ||
    a.owned_by.localeCompare(b.owned_by) ||
    (b.released ?? 0) - (a.released ?? 0) ||
    a.id.localeCompare(b.id),
);

// a8 ids drop the lab prefix (lib/models.ts), so they must stay unique.
const shortIds = new Set<string>();
for (const entry of entries) {
  const shortId = entry.id.slice(entry.id.indexOf("/") + 1);
  if (shortIds.has(shortId)) throw new Error(`Two models share ${shortId}.`);
  shortIds.add(shortId);
}

const rows = entries.map((entry) => ({
  gatewayId: entry.id,
  name: entry.name,
  lab: entry.owned_by,
  description: firstSentence(entry.description ?? ""),
  contextTokens: entry.context_window ?? 0,
  reads: (["image", "pdf"] as const).filter((kind) =>
    entry.modalities?.input?.includes(kind),
  ),
  usdPerMillionTokens: {
    input: perMillion(entry.pricing?.input),
    output: perMillion(entry.pricing?.output),
  },
  reasoning: entry.tags?.includes("reasoning") ?? false,
  fast: entry.tags?.includes("fast") ?? false,
  released: entry.released
    ? new Date(entry.released * 1000).toISOString().slice(0, 10)
    : null,
}));

const usedLabs = [...new Set(rows.map((row) => row.lab))];
await mkdir(LOGO_DIR, { recursive: true });
// models.dev answers an unknown name with a placeholder logo.
const placeholder = await fetchText(LOGO_URL("a8-no-such-lab"));
const labs = [];
for (const id of usedLabs) {
  const known = LABS.find((lab) => lab.id === id);
  let logo = false;
  if (known?.logo) {
    const svg = await fetchText(LOGO_URL(known.logo));
    if (svg !== placeholder) {
      await writeFile(join(LOGO_DIR, `${id}.svg`), svg);
      logo = true;
    }
  }
  labs.push({ id, name: known?.name ?? id, logo });
}

const syncedOn = new Date().toISOString().slice(0, 10);
await writeFile(
  OUT_FILE,
  `// Written by scripts/sync-models.ts from AI Gateway's model list. Don't
// edit it by hand: run the script again (ADR 0017).

/** The day the script last ran. */
export const SYNCED_ON = "${syncedOn}";

export type GatewayLab = { id: string; name: string; logo: boolean };

export type GatewayModel = {
  gatewayId: string;
  name: string;
  lab: string;
  description: string;
  contextTokens: number;
  reads: ("image" | "pdf")[];
  usdPerMillionTokens: { input: number; output: number };
  reasoning: boolean;
  fast: boolean;
  /** The day it came out, as YYYY-MM-DD, if the gateway says. */
  released: string | null;
};

/** Each lab with a model on the list, in the picker's order. */
export const GATEWAY_LABS: GatewayLab[] = ${lines(labs)};

/** Every chat model a8 offers, by lab, newest first. */
export const GATEWAY_MODELS: GatewayModel[] = ${lines(rows)};
`,
);

console.log(
  `Wrote ${rows.length} models from ${labs.length} labs, ${labs.filter((lab) => lab.logo).length} with logos.`,
);
const unnamed = labs.filter((lab) => !LABS.some(({ id }) => id === lab.id));
if (unnamed.length > 0) {
  console.log(
    `New labs, named by id: ${unnamed.map((lab) => lab.id).join(", ")}. Add them to LABS.`,
  );
}

/** An array literal with one item per line, so a diff shows each change. */
function lines(items: unknown[]): string {
  const body = items.map((item) => `  ${JSON.stringify(item)},`).join("\n");
  return `[\n${body}\n]`;
}

/** The description's first sentence, at most 160 characters. */
function firstSentence(text: string): string {
  const sentence = text.trim().split(/(?<=[.!?])\s/)[0] ?? "";
  if (sentence.length <= 160) return sentence;
  return `${sentence.slice(0, 157).replace(/\s+\S*$/, "")}…`;
}

/** A per-token price in USD, per million tokens. */
function perMillion(price: string | undefined): number {
  return Number((Number(price ?? 0) * 1_000_000).toPrecision(6));
}

async function fetchText(url: string): Promise<string> {
  const reply = await fetch(url);
  if (!reply.ok) throw new Error(`${url} answered ${reply.status}.`);
  return await reply.text();
}
