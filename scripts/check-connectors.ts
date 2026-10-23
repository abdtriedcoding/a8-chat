/**
 * Checks whether models on a8's list work with connectors and action cards
 * (ADR 0018), by calling Vercel AI Gateway the way a reply does on a thread
 * that defers connector tools (ADR 0006, ADR 0016). No browser and no
 * Convex. Each check asks for Todoist's projects and a new task, with fake
 * Todoist and Notion tools. A model passes when it finds the tools, lists
 * the projects, asks to add the task, which stops on its card, and then
 * replies with text once the user cancels the card. Writes each result to
 * convex/lib/connectorChecks.ts and keeps every entry it didn't run. Every
 * request costs money, so it stops starting models at the budget. Needs
 * AI_GATEWAY_API_KEY.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { anthropic } from "@ai-sdk/anthropic";
import {
  createGateway,
  generateText,
  jsonSchema,
  stepCountIs,
  tool,
  type JSONSchema7,
  type ModelMessage,
  type StepResult,
  type Tool,
  type ToolApprovalStatus,
  type ToolSet,
} from "ai";
import {
  CONNECTOR_CHECKS,
  type ConnectorCheck,
} from "../convex/lib/connectorChecks";
import type { Connector } from "../convex/lib/connectors";
import { GATEWAY_MODELS } from "../convex/lib/gatewayModels";
import {
  connectorInstructions,
  replyInstructions,
} from "../convex/lib/instructions";
import { findModel, isClaude, MODELS, type Model } from "../convex/lib/models";
import {
  arrangeReplyTools,
  FIND_TOOLS_KEY,
  TOOL_SEARCH_KEY,
  type ConnectorToolGroup,
  type ToolSearch,
} from "../convex/lib/toolLoading";
import { createFindTools } from "../convex/tools/findTools";
import { createScheduledPromptTools } from "../convex/tools/scheduledPrompts";

const DEFAULT_BUDGET_USD = 0.5;

const USAGE = `Usage: bun scripts/check-connectors.ts [options]

  With no options, checks every Free model that has no result yet.

  --model <id>      Check this model, by its a8 id or gateway id. Repeat it
                    for more. Pro models can be checked only this way.
  --all-free        Check every Free model, including ones checked before.
  --budget <usd>    Stop starting models once this many dollars are spent.
                    Defaults to ${DEFAULT_BUDGET_USD.toFixed(2)}.
  --dry-run         Print the models and an estimated cost. Spends nothing
                    and writes nothing.
  --no-write        Run the checks but leave convex/lib/connectorChecks.ts
                    as it is.

Reads the key from AI_GATEWAY_API_KEY. With ANTHROPIC_BYOK_API_KEY set, Claude
requests use that Anthropic key instead of the gateway's credits.`;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECKS_FILE = join(ROOT, "convex/lib/connectorChecks.ts");
/** The line of CHECKS_FILE where the entries start. Everything above it stays. */
const ENTRIES_START = "export const CONNECTOR_CHECKS";

/** How many models run at once. */
const CONCURRENCY = 4;
/** The most model calls before the cancel, and after it. */
const FIRST_CALL_STEPS = 6;
const CONTINUATION_STEPS = 2;
/** The most tokens one step can write, so a model that runs on costs little. */
const MAX_OUTPUT_TOKENS = 1500;
/**
 * About how many tokens one check reads and writes, for --dry-run. Taken
 * from the calibration runs, rounded up.
 */
const ESTIMATED_TOKENS = { input: 20_000, output: 1_500 };

/** How long to keep asking the gateway for a generation's cost. */
const COST_RETRIES = 5;
const COST_RETRY_MS = 2_000;

/**
 * The gateway's options for a call (gatewayOptions in convex/lib/gateway.ts).
 * Copied, since gateway.ts reads the Convex env when it loads.
 */
// TEMPORARY: revert the BYOK key once spec #334 is done.
const BYOK_KEY = process.env.ANTHROPIC_BYOK_API_KEY;
const CLAUDE_OPTIONS = {
  gateway: {
    only: ["anthropic"],
    ...(BYOK_KEY && { byok: { anthropic: [{ apiKey: BYOK_KEY }] } }),
  },
};
const OTHER_OPTIONS = { gateway: { caching: "auto" } };

/**
 * The reason a8 gives the model for a cancelled card (ACTION_CANCELLED in
 * convex/chat/approval.ts). Copied, since approval.ts loads the Convex app.
 */
const ACTION_CANCELLED = "The user cancelled this action.";

const PROMPT = `In Todoist, list my projects, then add a task called "a8 model check" to my Inbox.`;
/** The text the new task's input has to hold. */
const TASK_NAME = "a8 model check";

const READ_TOOL = "todoist__find-projects";
const ACTION_TOOL = "todoist__add-tasks";

/** The user's connections, as the instructions read them. */
const CONNECTIONS = [
  { connectorId: "todoist", status: "connected", accountLabel: "sam@example.com" },
  { connectorId: "notion", status: "connected", accountLabel: "Acme" },
] as const satisfies Parameters<typeof connectorInstructions>[0]["connections"];

/** The fake connector tools that need a card. */
const ACTIONS = new Set([ACTION_TOOL, "todoist__complete-tasks", "notion__create-pages"]);

/** A fake connector tool's input schema, without its `type: "object"`. */
type ToolInput = Pick<JSONSchema7, "properties" | "required">;

/**
 * Fake Todoist and Notion tools, named as a8 names MCP tools
 * (modelToolName in convex/lib/connectorView.ts), each with what it
 * returns. The add task input copies Todoist's add-tasks.
 */
const FAKE_CONNECTORS: {
  connector: { id: string; name: string };
  tools: Record<string, { description: string; input: ToolInput; output: unknown }>;
}[] = [
  {
    connector: { id: "todoist", name: "Todoist" },
    tools: {
      "todoist__find-tasks": {
        description: "Find tasks by text, project, section or label.",
        input: { properties: { searchText: { type: "string" }, projectId: { type: "string" } } },
        output: { tasks: [] },
      },
      [READ_TOOL]: {
        description: "List the user's projects, or find projects by name.",
        input: { properties: { search: { type: "string" } } },
        output: {
          projects: [
            { id: "6Jf8VQXxpwv56VQ7", name: "Inbox", isInboxProject: true },
            { id: "6Jf8VQXxpwv56VQ8", name: "Work" },
          ],
        },
      },
      [ACTION_TOOL]: {
        description: "Add one or more tasks, each with its content and an optional project, due date and priority.",
        input: {
          properties: {
            tasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  content: { type: "string", description: "The task's name." },
                  projectId: { type: "string" },
                  dueString: { type: "string", description: "Like \"tomorrow\"." },
                  priority: { type: "string", enum: ["p1", "p2", "p3", "p4"] },
                },
                required: ["content"],
              },
            },
          },
          required: ["tasks"],
        },
        output: { tasks: [{ id: "8485093748", content: TASK_NAME }] },
      },
      "todoist__complete-tasks": {
        description: "Mark tasks complete by their IDs.",
        input: {
          properties: { ids: { type: "array", items: { type: "string" } } },
          required: ["ids"],
        },
        output: { completed: [] },
      },
    },
  },
  {
    connector: { id: "notion", name: "Notion" },
    tools: {
      notion__search: {
        description: "Search pages and databases in the user's workspace.",
        input: { properties: { query: { type: "string" } }, required: ["query"] },
        output: { results: [] },
      },
      notion__fetch: {
        description: "Read a page or database by its URL or ID.",
        input: { properties: { id: { type: "string" } }, required: ["id"] },
        output: { error: "Not found." },
      },
      "notion__create-pages": {
        description: "Create pages under a parent page or in a database.",
        input: {
          properties: {
            parent: { type: "string" },
            pages: { type: "array", items: { type: "object" } },
          },
          required: ["pages"],
        },
        output: { pages: [] },
      },
    },
  },
];

const { values } = parseArgs({
  options: {
    model: { type: "string", multiple: true },
    "all-free": { type: "boolean" },
    budget: { type: "string" },
    "dry-run": { type: "boolean" },
    "no-write": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
const budget = values.budget === undefined ? DEFAULT_BUDGET_USD : Number(values.budget);
if (!Number.isFinite(budget) || budget <= 0) {
  console.error(`--budget takes a number of dollars above 0, not "${values.budget}".\n`);
  console.log(USAGE);
  process.exit(2);
}

const selected = selectModels();
if (selected.length === 0) {
  console.log("No models to check. Every Free model has a result. Use --all-free or --model.");
  process.exit(0);
}

if (values["dry-run"]) {
  heading(`${selected.length} model(s) would run`);
  let total = 0;
  for (const model of selected) {
    const estimate = estimateCost(model);
    total += estimate;
    console.log(`${model.gatewayId.padEnd(44)} about $${estimate.toFixed(4)}`);
  }
  heading(`About $${total.toFixed(4)} in all, with a budget of $${budget.toFixed(2)}`);
  process.exit(0);
}

if (!process.env.AI_GATEWAY_API_KEY) {
  console.error("Set AI_GATEWAY_API_KEY.\n");
  console.log(USAGE);
  process.exit(2);
}

const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY });
/** Dollars spent so far, across every model. */
let spent = 0;
/**
 * Set when a step's cost can't be found. `spent` is then too low, so no
 * new model starts.
 */
let costUnknown = false;

heading(`Checking ${selected.length} model(s), budget $${budget.toFixed(2)}`);
const queue = [...selected];
const results = new Map<string, ConnectorCheck>();
await Promise.all(Array.from({ length: CONCURRENCY }, runQueue));
const skipped = queue.length;

const passed = [...results.values()].filter((result) => result.passed).length;
heading("Totals");
console.log(`${results.size} checked: ${passed} passed, ${results.size - passed} failed`);
if (skipped > 0) {
  console.log(
    costUnknown
      ? `${skipped} not started, since a step's cost couldn't be found`
      : `${skipped} not started, since the budget ran out`,
  );
}
console.log(`spent $${spent.toFixed(4)}`);

if (values["no-write"]) {
  console.log("--no-write: left convex/lib/connectorChecks.ts as it is.");
} else if (results.size > 0) {
  await writeChecks(results);
  console.log("Wrote convex/lib/connectorChecks.ts.");
}

/**
 * Takes models off the queue until it's empty, the budget is spent, or a
 * cost is unknown.
 */
async function runQueue() {
  while (queue.length > 0 && spent < budget && !costUnknown) {
    const model = queue.shift()!;
    const { passed, note, cost } = await checkModel(model);
    results.set(model.gatewayId, {
      passed,
      on: today(),
      by: "script",
      ...(note !== undefined && { note }),
    });
    console.log(
      `${model.gatewayId.padEnd(44)} ${passed ? "pass" : "FAIL"}  $${cost.toFixed(4)}${note ? `  ${note}` : ""}`,
    );
  }
}

/** The models the options name, in MODELS order. */
function selectModels(): Model[] {
  const ids = new Set<string>();
  for (const id of values.model ?? []) {
    const model = findModel(id) ?? MODELS.find((entry) => entry.gatewayId === id);
    if (!model) {
      console.error(`${id} isn't on a8's model list.\n`);
      console.log(USAGE);
      process.exit(2);
    }
    ids.add(model.gatewayId);
  }
  const free = MODELS.filter((model) => model.plans.includes("free"));
  if (values["all-free"]) {
    for (const model of free) ids.add(model.gatewayId);
  } else if (ids.size === 0) {
    for (const model of free) {
      if (!CONNECTOR_CHECKS[model.gatewayId]) ids.add(model.gatewayId);
    }
  }
  return MODELS.filter((model) => ids.has(model.gatewayId));
}

/** About what one check costs on the model, at its gateway prices. */
function estimateCost(model: Model): number {
  const prices = GATEWAY_MODELS.find(
    (entry) => entry.gatewayId === model.gatewayId,
  )?.usdPerMillionTokens;
  if (!prices) return 0;
  return (
    (ESTIMATED_TOKENS.input * prices.input + ESTIMATED_TOKENS.output * prices.output) /
    1_000_000
  );
}

/**
 * One model's check. The first call runs the prompt until the model stops
 * on an action card or runs out of steps. The second sends that history
 * back with every card cancelled, as Cancel on the card does
 * (decideAction in convex/chat/approval.ts). Any error from the gateway
 * fails the check.
 */
async function checkModel(
  model: Model,
): Promise<{ passed: boolean; note?: string; cost: number }> {
  const meter = costMeter();
  const reply = fakeReply(model);
  const fail = async (note: string) => ({ passed: false, note, cost: await meter.total() });

  let first;
  try {
    first = await generateText({
      ...reply.callOptions(FIRST_CALL_STEPS),
      messages: [{ role: "user", content: PROMPT }],
      onStepFinish: meter.add,
    });
  } catch (error) {
    return await fail(describeError(error));
  }
  const steps = first.steps;
  const calls = toolCalls(steps);
  const searched = steps.some((step) =>
    step.content.some(
      (part) => part.type === "tool-call" && isSearch(part.toolName),
    ),
  );
  if (!searched) {
    const other = [...new Set(calls)];
    if (other.length > 0) {
      return await fail(
        `Never searched for the connector tools, and called ${other.join(", ")} instead.`,
      );
    }
    return await fail(
      writesToolsAsText(steps)
        ? "Wrote the tool calls as text instead of making them."
        : "Never searched for the connector tools.",
    );
  }
  if (!calls.includes(READ_TOOL)) {
    return await fail(
      reply.found.has(READ_TOOL)
        ? "Found the Todoist tools but never listed the projects."
        : "Searched, but never found the Todoist tools.",
    );
  }
  if (reply.executed.has(ACTION_TOOL)) {
    return await fail("Added the task without stopping on its card.");
  }
  const requests = steps.flatMap((step) =>
    step.content.flatMap((part) =>
      part.type === "tool-approval-request" ? [part] : [],
    ),
  );
  const addRequests = requests.filter(
    (request) => request.toolCall.toolName === ACTION_TOOL,
  );
  if (addRequests.length === 0) {
    if (calls.includes(ACTION_TOOL)) {
      return await fail("Called the add task tool with input the tool doesn't take.");
    }
    if (steps.some((step) => step.finishReason === "length")) {
      return await fail("Ran out of output tokens before it asked to add the task.");
    }
    return await fail("Listed the projects but never asked to add the task.");
  }
  if (
    !addRequests.some((request) =>
      JSON.stringify(request.toolCall.input).toLowerCase().includes(TASK_NAME),
    )
  ) {
    return await fail(`Asked to add a task without the name "${TASK_NAME}".`);
  }

  const messages: ModelMessage[] = [
    { role: "user", content: PROMPT },
    ...first.responseMessages,
    {
      role: "tool",
      content: requests.map((request) => ({
        type: "tool-approval-response" as const,
        approvalId: request.approvalId,
        approved: false,
        reason: ACTION_CANCELLED,
      })),
    },
  ];
  let continuation;
  try {
    continuation = await generateText({
      ...reply.callOptions(CONTINUATION_STEPS),
      messages,
      onStepFinish: meter.add,
    });
  } catch (error) {
    return await fail(`After the cancel, ${lowerFirst(describeError(error))}`);
  }
  if (toolCalls(continuation.steps).includes(ACTION_TOOL)) {
    return await fail("Tried the cancelled task again instead of replying.");
  }
  if (continuation.text.trim() === "") {
    return await fail("Didn't reply with text after the user cancelled the task.");
  }
  return { passed: true, cost: await meter.total() };
}

/**
 * The tools, instructions and options of a reply on a thread where the
 * user connected Todoist and Notion and their tools are deferred
 * (createReplyTools in convex/lib/replyTools.ts, streamReply in
 * convex/chat/reply.ts). `found` holds what a8's search found, as the
 * thread records it, so the continuation loads those tools. `executed`
 * holds every tool that ran.
 */
function fakeReply(model: Model) {
  const claude = isClaude(model);
  const found = new Set<string>();
  const executed = new Set<string>();
  const groups = fakeConnectorGroups(executed);
  const scheduled = createScheduledPromptTools("UTC");
  // The scheduled prompt tools read and write Convex, so these answer as
  // if the user has none.
  const scheduledTools: ToolSet = Object.fromEntries(
    Object.entries(scheduled.tools).map(([name, scheduledTool]) => [
      name,
      {
        ...scheduledTool,
        execute: async () => {
          executed.add(name);
          return [];
        },
      } as Tool,
    ]),
  );
  const search: ToolSearch = claude
    ? { kind: "anthropic", tool: anthropic.tools.toolSearchBm25_20251119() }
    : {
        kind: "a8",
        create: (deferredTools) =>
          withCtx(
            createFindTools(deferredTools, async (names) => {
              for (const name of names) found.add(name);
            }),
          ),
      };
  const toolApproval: Record<string, ToolApprovalStatus> = {
    ...Object.fromEntries(
      groups.flatMap((group) =>
        Object.keys(group.tools)
          .filter((name) => ACTIONS.has(name))
          .map((name) => [name, "user-approval" as const]),
      ),
    ),
    ...scheduled.toolApproval,
  };

  /** generateText's options for one call of `maxSteps` steps. */
  const callOptions = (maxSteps: number) => {
    // Each call arranges the tools again, as each reply does, so the
    // continuation loads the tools the first call found.
    const { tools, loading, loaded } = arrangeReplyTools({
      nativeTools: { webSearch: fakeWebSearch(executed), ...scheduledTools },
      groups,
      mentioned: [],
      deferred: true,
      found,
      search,
    });
    const activeTools = () => loaded && [...new Set([...loaded, ...found])];
    return {
      model: gateway(model.gatewayId),
      providerOptions: claude ? CLAUDE_OPTIONS : OTHER_OPTIONS,
      system: replyInstructions({
        timeZone: "UTC",
        now: new Date(),
        canSearchWeb: true,
        canSchedule: true,
        connectorText: connectorInstructions({
          connections: CONNECTIONS,
          loading,
          searchTool: claude ? TOOL_SEARCH_KEY : FIND_TOOLS_KEY,
        }),
        autoApprove: false,
      }),
      tools,
      toolApproval,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      stopWhen: stepCountIs(maxSteps),
      // As in streamReply: the last step can't call tools, and other
      // models see only the tools found so far.
      prepareStep: ({ stepNumber }: { stepNumber: number }) => {
        const lastStep = stepNumber === maxSteps - 1;
        if (claude) return lastStep ? { activeTools: [] } : {};
        return lastStep
          ? { activeTools: activeTools(), toolChoice: "none" as const }
          : { activeTools: activeTools() };
      },
    };
  };

  return { found, executed, callOptions };
}

/**
 * The fake connectors as a reply's tool groups. Each result comes wrapped
 * as a8 wraps connector results (wrapResult in convex/lib/connectorTools.ts).
 */
function fakeConnectorGroups(executed: Set<string>): ConnectorToolGroup[] {
  return FAKE_CONNECTORS.map(({ connector, tools }) => ({
    // toolLoading.ts reads only the connector's id and name.
    connector: connector as unknown as Connector,
    tools: Object.fromEntries(
      Object.entries(tools).map(([name, { description, input, output }]) => [
        name,
        tool({
          description,
          inputSchema: jsonSchema<Record<string, unknown>>({ type: "object", ...input }),
          execute: async () => {
            executed.add(name);
            return `<untrusted-data source="${connector.name}">\n${JSON.stringify(output)}\n</untrusted-data>`;
          },
        }),
      ]),
    ),
    estimatedTokens: 0,
  }));
}

/**
 * Web search, as a8 offers it (convex/tools/webSearch.ts, which reads the
 * Convex env when it loads). It answers as if search found nothing.
 */
function fakeWebSearch(executed: Set<string>): Tool {
  return tool({
    description:
      "Search the web for current information. Returns up to 5 results, " +
      "each with a title, URL and snippet, and sometimes a published date.",
    inputSchema: jsonSchema<{ query: string }>({
      type: "object",
      properties: { query: { type: "string", maxLength: 400 } },
      required: ["query"],
    }),
    execute: async () => {
      executed.add("webSearch");
      return [];
    },
  });
}

/**
 * The tool with a ctx, as the Agent gives tools made with createTool
 * (wrapTools in @convex-dev/agent). findTools doesn't use it, but its
 * execute throws without one.
 */
function withCtx(convexTool: Tool): Tool {
  return { ...convexTool, ctx: {} } as unknown as Tool;
}

/** Adds up a check's cost from each step's gateway metadata. */
function costMeter() {
  let known = 0;
  const lookups: string[] = [];
  return {
    add: (step: StepResult<ToolSet>) => {
      const gatewayMeta = step.providerMetadata?.gateway;
      const cost = Number(gatewayMeta?.cost);
      if (Number.isFinite(cost) && gatewayMeta?.cost !== undefined) {
        known += cost;
        spent += cost;
      } else if (typeof gatewayMeta?.generationId === "string") {
        lookups.push(gatewayMeta.generationId);
      } else {
        costUnknown = true;
      }
    },
    /**
     * The check's cost, after looking up steps whose metadata had none. A
     * lookup that finds no cost sets costUnknown.
     */
    total: async () => {
      for (const id of lookups.splice(0)) {
        const cost = (await generationInfo(id))?.totalCost;
        if (typeof cost !== "number" || !Number.isFinite(cost)) {
          costUnknown = true;
          continue;
        }
        known += cost;
        spent += cost;
      }
      return known;
    },
  };
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

/** The client tools the model called, other than search. */
function toolCalls(steps: StepResult<ToolSet>[]): string[] {
  return steps.flatMap((step) =>
    step.content.flatMap((part) =>
      part.type === "tool-call" && !isSearch(part.toolName) ? [part.toolName] : [],
    ),
  );
}

function isSearch(toolName: string): boolean {
  return toolName === FIND_TOOLS_KEY || toolName === TOOL_SEARCH_KEY;
}

/** Whether the model's text names the tools, as a model that types calls does. */
function writesToolsAsText(steps: StepResult<ToolSet>[]): boolean {
  return steps.some((step) => /findTools|todoist__|notion__|"name"\s*:/i.test(step.text));
}

/** Rewrites the entries of CHECKS_FILE, keeping everything above them. */
async function writeChecks(newResults: Map<string, ConnectorCheck>) {
  const text = await readFile(CHECKS_FILE, "utf8");
  const start = text.indexOf(ENTRIES_START);
  if (start === -1) throw new Error(`${CHECKS_FILE} has no "${ENTRIES_START}".`);
  const merged: Record<string, ConnectorCheck> = { ...CONNECTOR_CHECKS };
  for (const [id, result] of newResults) merged[id] = result;
  const order = new Map(MODELS.map((model, index) => [model.gatewayId, index]));
  const ids = Object.keys(merged).sort(
    (a, b) =>
      (order.get(a) ?? MODELS.length) - (order.get(b) ?? MODELS.length) ||
      a.localeCompare(b),
  );
  // One entry per line, so a diff shows each change.
  const body = ids
    .map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(merged[id])},`)
    .join("\n");
  await writeFile(
    CHECKS_FILE,
    `${text.slice(0, start)}${ENTRIES_START}: Record<string, ConnectorCheck> = {\n${body}\n};\n`,
  );
}

/** The local day, as YYYY-MM-DD, the form the browser checks use. */
function today(): string {
  return new Date().toLocaleDateString("en-CA");
}

function heading(text: string) {
  console.log(`\n== ${text}`);
}

/**
 * The error as one short sentence for a note. An error from the gateway
 * gives its status, like "The gateway answered 404."
 */
function describeError(error: unknown): string {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof status === "number") return `The gateway answered ${status}.`;
  const message = error instanceof Error ? error.message : String(error);
  const sentence = message.trim().split(/(?<=[.!?])\s/)[0]?.slice(0, 160) ?? "";
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
