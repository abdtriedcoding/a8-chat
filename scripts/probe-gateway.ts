/**
 * Checks whether Claude works through Vercel AI Gateway with everything a8
 * relies on (ADR 0015): Anthropic's BM25 tool search, deferred tools, cache
 * breakpoints, and a client tool call next to tool search results
 * (vercel/ai#21895). It pins every request to Anthropic. Prints pass or
 * fail for each check, then the cost. A dev helper, not a test. Needs
 * AI_GATEWAY_API_KEY.
 */
import { parseArgs } from "node:util";
import { anthropic } from "@ai-sdk/anthropic";
import {
  createGateway,
  generateText,
  jsonSchema,
  stepCountIs,
  tool,
  type LanguageModelUsage,
  type ModelMessage,
  type StepResult,
  type Tool,
  type ToolSet,
} from "ai";
import { TOOL_SEARCH_KEY } from "../convex/lib/toolLoading";

const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";

const USAGE = `Usage: bun scripts/probe-gateway.ts [options]

  --model <id>  The gateway model to probe. Defaults to ${DEFAULT_MODEL}.

Reads the key from AI_GATEWAY_API_KEY.`;

/** Sends every request to Anthropic, so a pass can't come from another host. */
const PIN_TO_ANTHROPIC = { gateway: { only: ["anthropic"] } };

/**
 * The breakpoint a8 sends (CACHE_BREAKPOINT in convex/lib/replyTools.ts).
 * Copied, since replyTools.ts reads the Convex env when it loads.
 */
const CACHE_BREAKPOINT = {
  anthropic: { cacheControl: { type: "ephemeral" } },
} as const;

/** The deferred tool the tool search check asks for. */
const TARGET_TOOL = "linear_create_issue";
/** The deferred tool only the pairing check's replayed search loads. */
const PAIRED_TOOL = "github_list_pull_requests";
/** What a8's Linear tool returns for the issue it made. */
const CREATED_ISSUE = { id: "ENG-1", url: "https://linear.app/acme/issue/ENG-1" };
const LINEAR_PROMPT = `Create a Linear issue in team ENG titled "Gateway probe".`;
const OK_PROMPT = "Reply with the word OK and nothing else.";

/**
 * Filler for the cache check's prompt. Anthropic caches only prompts over
 * a minimum length that depends on the model, a few thousand tokens on
 * Haiku, so this aims well past it.
 */
const CACHE_FILLER_TOKENS = 8_000;

/** How long to keep asking the gateway for a generation's cost. */
const COST_RETRIES = 5;
const COST_RETRY_MS = 2_000;

const { values } = parseArgs({
  options: {
    model: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!process.env.AI_GATEWAY_API_KEY) {
  console.error("Set AI_GATEWAY_API_KEY.\n");
  console.log(USAGE);
  process.exit(2);
}

const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY });
const modelId = values.model ?? DEFAULT_MODEL;
/** Each request's generation ID, for the cost. */
const generationIds: string[] = [];
const results: { name: string; ok: boolean }[] = [];

/** A fake connector tool's input schema, without its `type: "object"`. */
type ToolInput = {
  properties: Record<string, { type: "string"; description: string }>;
  required: string[];
};

/** The input of a fake connector tool that creates something. */
const CREATE_INPUT: ToolInput = {
  properties: {
    team: { type: "string", description: "The team, project or repository." },
    title: { type: "string", description: "A short title." },
    body: { type: "string", description: "The longer text, in Markdown." },
  },
  required: ["title"],
};

/**
 * Fake connector tools, shaped like a8's: name, description, input schema.
 * A tool without `input` takes CREATE_INPUT.
 */
const connectorTools: Record<
  string,
  { connector: string; description: string; input?: ToolInput }
> = {
  linear_create_issue: {
    connector: "Linear",
    description: "Create an issue in a Linear team with a title and description.",
  },
  linear_search_issues: {
    connector: "Linear",
    description: "Search Linear issues by text, assignee or state.",
  },
  github_create_issue: {
    connector: "GitHub",
    description: "Open an issue on a GitHub repository.",
  },
  github_list_pull_requests: {
    connector: "GitHub",
    description: "List open pull requests on a GitHub repository.",
    input: {
      properties: {
        repository: { type: "string", description: "The repository, as owner/name." },
      },
      required: ["repository"],
    },
  },
  notion_search: {
    connector: "Notion",
    description: "Search pages and databases in the user's Notion workspace.",
  },
  notion_create_page: {
    connector: "Notion",
    description: "Create a page in a Notion database or under a parent page.",
  },
  todoist_add_task: {
    connector: "Todoist",
    description: "Add a task to a Todoist project, with an optional due date.",
  },
  gmail_send_email: {
    connector: "Gmail",
    description: "Send an email from the user's Gmail account.",
  },
};

heading(`${modelId} through AI Gateway, pinned to Anthropic`);

await check("tool search finds a deferred tool", checkToolSearch);
await check("deferred tools stay out of the prompt", checkDeferredLoading);
await check("cache breakpoints give cache reads", checkCacheReads);
await check("tool pairing survives tool search results", checkToolPairing);

heading("Cost");
await printCost();

const failed = results.filter((result) => !result.ok);
heading(failed.length === 0 ? "Every check passed" : `${failed.length} check(s) failed`);
for (const result of results) {
  console.log(`${result.ok ? "pass" : "FAIL"}  ${result.name}`);
}
process.exit(failed.length === 0 ? 0 : 1);

/**
 * Asks for a Linear issue with every connector tool deferred. Passes when
 * a tool search result names linear_create_issue and the model calls it.
 * The second step sends that history back, as a reply would.
 */
async function checkToolSearch(): Promise<boolean> {
  const result = await generate({
    system: connectionsPrompt(),
    prompt: `${LINEAR_PROMPT} Use the ${TARGET_TOOL} tool.`,
    tools: replyTools({ deferred: true, executeTarget: true }),
    stopWhen: stepCountIs(2),
  });
  const found = searchedToolNames(result.steps);
  const called = calledTools(result.steps).includes(TARGET_TOOL);
  console.log(`searches found: ${found.length > 0 ? found.join(", ") : "nothing"}`);
  console.log(`model called ${TARGET_TOOL}: ${called ? "yes" : "no"}`);
  console.log(`steps: ${result.steps.length}, finish: ${result.finishReason}`);
  return found.includes(TARGET_TOOL) && called;
}

/**
 * Sends one short prompt three ways: with tool search and no connector
 * tools, with every connector tool loaded, and with every connector tool
 * deferred. Passes when deferring adds under a tenth of what loading adds.
 */
async function checkDeferredLoading(): Promise<boolean> {
  const ask = async (tools: ToolSet) => {
    const result = await generate({
      prompt: OK_PROMPT,
      tools,
      toolChoice: "none",
      maxOutputTokens: 16,
    });
    return result.usage.inputTokens ?? 0;
  };
  const bare = await ask(replyTools({ connectors: false }));
  const loaded = await ask(replyTools({ deferred: false }));
  const deferred = await ask(replyTools({ deferred: true }));
  console.log(`input tokens: ${bare} bare, ${loaded} loaded, ${deferred} deferred`);
  const loadedCost = loaded - bare;
  const deferredCost = deferred - bare;
  console.log(
    `connector tools add ${loadedCost} tokens loaded, ${deferredCost} deferred`,
  );
  return loadedCost > 0 && deferredCost < loadedCost / 10;
}

/**
 * Sends the same long prompt twice with a breakpoint on it, and the
 * deferred tools a8 would send. Passes when the first request writes the
 * cache and the second reads it. A control sends another prompt twice
 * without the breakpoint, to show the reads come from the breakpoint and
 * not from caching the gateway adds. Each run's prompts start with a new
 * nonce, so an earlier run's cache can't answer.
 */
async function checkCacheReads(): Promise<boolean> {
  const twice = async (label: string, breakpoint: boolean) => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: `Notes ${crypto.randomUUID()}.\n\n${filler(CACHE_FILLER_TOKENS)}`,
        ...(breakpoint && { providerOptions: CACHE_BREAKPOINT }),
      },
      { role: "user", content: OK_PROMPT },
    ];
    const usages: LanguageModelUsage[] = [];
    for (const attempt of ["first", "second"]) {
      const result = await generate({
        system: connectionsPrompt(),
        messages,
        tools: replyTools({ deferred: true }),
        toolChoice: "none",
        maxOutputTokens: 16,
      });
      usages.push(result.usage);
      console.log(`${label}, ${attempt}: ${describeCache(result.usage)}`);
    }
    return usages;
  };
  const [first, second] = await twice("breakpoint", true);
  const [, controlSecond] = await twice("no breakpoint", false);
  return (
    (first.inputTokenDetails.cacheWriteTokens ?? 0) > 0 &&
    (second.inputTokenDetails.cacheReadTokens ?? 0) > 0 &&
    (controlSecond.inputTokenDetails.cacheReadTokens ?? 0) === 0
  );
}

/**
 * Replays a history in the order vercel/ai#21895 says the gateway breaks:
 * a client tool call before two tool search results, then the client
 * call's result. The issue reports that Anthropic takes it directly.
 * Passes when the gateway takes it and the model calls
 * github_list_pull_requests without searching again. Only the replayed
 * search loads that tool, so the call shows the search results reached
 * Anthropic.
 */
async function checkToolPairing(): Promise<boolean> {
  const search = (id: string, query: string, found: string) =>
    [
      {
        type: "tool-call",
        toolCallId: id,
        toolName: TOOL_SEARCH_KEY,
        input: { query },
        providerExecuted: true,
      },
      {
        type: "tool-result",
        toolCallId: id,
        toolName: TOOL_SEARCH_KEY,
        output: {
          type: "json",
          value: [{ type: "tool_reference", toolName: found }],
        },
      },
    ] as const;
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: `${LINEAR_PROMPT} Then list the open pull requests on GitHub repository acme/web.`,
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "toolu_01ProbeClientCall0000001",
          toolName: TARGET_TOOL,
          input: { team: "ENG", title: "Gateway probe" },
        },
        ...search("srvtoolu_01ProbeSearch00000001", "create linear issue", TARGET_TOOL),
        ...search("srvtoolu_01ProbeSearch00000002", "github pull requests", PAIRED_TOOL),
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "toolu_01ProbeClientCall0000001",
          toolName: TARGET_TOOL,
          output: { type: "json", value: CREATED_ISSUE },
        },
      ],
    },
  ];
  let result;
  try {
    result = await generate({
      system: connectionsPrompt(),
      messages,
      tools: replyTools({ deferred: true }),
      maxOutputTokens: 1024,
    });
  } catch (error) {
    console.log(`refused: ${describeError(error)}`);
    return false;
  }
  const called = calledTools(result.steps);
  const searched = searchedToolNames(result.steps).length > 0;
  console.log(`accepted, finish: ${result.finishReason}`);
  console.log(`model called: ${called.length > 0 ? called.join(", ") : "nothing"}`);
  console.log(`model searched again: ${searched ? "yes" : "no"}`);
  if (result.text) console.log(`reply: ${result.text.slice(0, 300)}`);
  return called.includes(PAIRED_TOOL) && !searched;
}

/** Runs one check, printing its heading and result. A throw fails it. */
async function check(name: string, run: () => Promise<boolean>) {
  heading(name);
  let ok = false;
  try {
    ok = await run();
  } catch (error) {
    console.log(`error: ${describeError(error)}`);
  }
  console.log(ok ? "pass" : "FAIL");
  results.push({ name, ok });
}

/**
 * generateText on the probed model, pinned to Anthropic. Keeps each step's
 * generation ID for printCost.
 */
async function generate(
  options: Omit<Parameters<typeof generateText>[0], "model" | "providerOptions">,
) {
  const result = await generateText({
    ...options,
    model: gateway(modelId),
    providerOptions: PIN_TO_ANTHROPIC,
  } as Parameters<typeof generateText>[0]);
  for (const step of result.steps) {
    const id = step.providerMetadata?.gateway?.generationId;
    if (typeof id === "string") generationIds.push(id);
  }
  return result;
}

/**
 * The tools a8 sends on a reply that defers: the loaded native tool, tool
 * search, and the connector tools, each description starting with its
 * connector in brackets (deferTool in convex/lib/toolLoading.ts). With
 * `connectors` false, only the first two.
 */
function replyTools({
  deferred = false,
  connectors = true,
  executeTarget = false,
}: {
  deferred?: boolean;
  connectors?: boolean;
  executeTarget?: boolean;
}): ToolSet {
  const tools: ToolSet = {
    webSearch: tool({
      description: "Search the web for current information.",
      inputSchema: jsonSchema<{ query: string }>({
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      }),
    }),
    [TOOL_SEARCH_KEY]: anthropic.tools.toolSearchBm25_20251119(),
  };
  if (!connectors) return tools;
  for (const [name, { connector, description, input = CREATE_INPUT }] of Object.entries(
    connectorTools,
  )) {
    // tool() can't infer a type from the optional parts spread in, so
    // this builds the Tool by hand, and TypeScript needs the cast.
    tools[name] = {
      description: `[${connector}] ${description} ${usageNotes(name)}`,
      inputSchema: jsonSchema<Record<string, unknown>>({ type: "object", ...input }),
      ...(executeTarget &&
        name === TARGET_TOOL && { execute: async () => CREATED_ISSUE }),
      ...(deferred && {
        providerOptions: { anthropic: { deferLoading: true } },
      }),
    } as Tool;
  }
  return tools;
}

/**
 * Usage notes, so each connector tool's definition is long enough that
 * loading it shows up clearly in the input tokens.
 */
function usageNotes(name: string): string {
  return `Usage notes for ${name}: ${"Ask before changing anything the user didn't name. ".repeat(20)}`;
}

/** Names the user's connections, as a8's connector instructions do. */
function connectionsPrompt(): string {
  const connectors = [...new Set(Object.values(connectorTools).map((t) => t.connector))];
  return `You are a8. The user connected ${connectors.join(", ")}. Their tools are deferred: search for one before you call it.`;
}

/** About `tokens` tokens of text that doesn't repeat, at 4 characters a token. */
function filler(tokens: number): string {
  const lines: string[] = [];
  for (let i = 0; lines.join("\n").length < tokens * 4; i++) {
    lines.push(`Note ${i}: the build on branch ${i * 7919 % 10007} passed after ${i % 13} retries.`);
  }
  return lines.join("\n");
}

/** Every tool name the steps' tool search results point at. */
function searchedToolNames(steps: StepResult<ToolSet>[]): string[] {
  const names = new Set<string>();
  for (const step of steps) {
    for (const part of step.content) {
      if (part.type !== "tool-result" || part.toolName !== TOOL_SEARCH_KEY) continue;
      const output = part.output;
      if (!Array.isArray(output)) continue;
      for (const reference of output) {
        if (typeof reference?.toolName === "string") names.add(reference.toolName);
      }
    }
  }
  return [...names];
}

/** The client tools the model called across the steps. */
function calledTools(steps: StepResult<ToolSet>[]): string[] {
  return steps.flatMap((step) =>
    step.toolCalls
      .filter((call) => call.toolName !== TOOL_SEARCH_KEY)
      .map((call) => call.toolName),
  );
}

function describeCache(usage: LanguageModelUsage): string {
  const details = usage.inputTokenDetails;
  return `${usage.inputTokens ?? 0} input tokens, ${details.cacheWriteTokens ?? 0} cache writes, ${details.cacheReadTokens ?? 0} cache reads`;
}

/**
 * Adds up every generation's cost from the gateway (getGenerationInfo).
 * The gateway records a generation shortly after it ends, so a lookup can
 * miss at first. Requests that threw have no generation ID and aren't
 * counted.
 */
async function printCost() {
  let total = 0;
  const providers = new Set<string>();
  let missing = 0;
  for (const id of generationIds) {
    const info = await generationInfo(id);
    if (!info) {
      missing++;
      continue;
    }
    total += info.totalCost;
    providers.add(info.providerName);
  }
  console.log(`${generationIds.length} generations, $${total.toFixed(4)}`);
  console.log(`served by: ${providers.size > 0 ? [...providers].join(", ") : "unknown"}`);
  if (missing > 0) console.log(`${missing} generation(s) had no cost yet`);
}

async function generationInfo(id: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await gateway.getGenerationInfo({ id });
    } catch (error) {
      if (attempt === COST_RETRIES) {
        console.log(`no cost for ${id}: ${describeError(error)}`);
        return undefined;
      }
      await new Promise((resolve) => setTimeout(resolve, COST_RETRY_MS));
    }
  }
}

function heading(text: string) {
  console.log(`\n== ${text}`);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
