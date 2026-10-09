// A reply's connector tools (ADR 0003, ADR 0005). They're built from each
// connection's cached tool list, so building them sends nothing to the
// vendor. A connector's MCP client opens on the first call to one of its
// tools in the reply, and the reply closes it when it ends.

import {
  MCPClientError,
  type CallToolResult,
  type ListToolsResult,
  type MCPClient,
} from "@ai-sdk/mcp";
import {
  jsonSchema,
  tool,
  type JSONSchema7,
  type ToolApprovalStatus,
  type ToolSet,
} from "ai";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { createConnectorClient, decryptAccessToken } from "./connectorAuth";
import {
  findConnector,
  findConnectorTool,
  modelToolName,
  type Connector,
} from "./connectors";

/** The most of a tool result the model sees, in UTF-8 bytes. */
const MAX_RESULT_BYTES = 20_000;

/** How old a cached tool list can get before a reply asks for a new one. */
const TOOL_LIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** How long one tool call can take before a8 gives up on it. */
const TOOL_CALL_TIMEOUT_MS = 60_000;

/** The tag a connector tool's result is wrapped in for the model. */
const UNTRUSTED_TAG = "untrusted-data";

type McpTool = ListToolsResult["tools"][number];

export type ConnectorTools = {
  /** The tools of every connected connection, named `<handle>__<tool>`. */
  tools: ToolSet;
  /**
   * The reply's `toolApproval` option. It makes every action wait for the
   * user to approve it (ADR 0002). Reads aren't listed, so they run at once.
   */
  toolApproval: Record<string, ToolApprovalStatus>;
  /** Closes every MCP client the reply opened. Call it once the reply ends. */
  close: () => Promise<void>;
};

/**
 * The reply's tools from the user's connections. Only `connected`
 * connections get tools, and only the allowlisted ones. A tool list over a
 * day old is used as is, and a fresh one is fetched in the background for
 * later replies.
 */
export async function createConnectorTools(
  ctx: ActionCtx,
  connections: Doc<"connections">[],
): Promise<ConnectorTools> {
  const tools: ToolSet = {};
  const toolApproval: Record<string, ToolApprovalStatus> = {};
  const opened: Promise<MCPClient>[] = [];

  for (const connection of connections) {
    const connector = findConnector(connection.connectorId);
    if (!connector || connection.status !== "connected") continue;
    if (Date.now() - connection.toolListFetchedAt > TOOL_LIST_MAX_AGE_MS) {
      await scheduleToolListRefresh(ctx, connection);
    }

    let client: Promise<MCPClient> | undefined;
    const openClient = () => {
      if (!client) {
        client = decryptAccessToken(connection).then((accessToken) =>
          createConnectorClient(connector, accessToken),
        );
        opened.push(client);
        // A failed connect is tried again on the next call.
        client.catch(() => {
          client = undefined;
        });
      }
      return client;
    };

    for (const mcpTool of allowedTools(connector, connection.toolList)) {
      const name = modelToolName(connector, mcpTool.name);
      if (!isRead(connector, mcpTool)) toolApproval[name] = "user-approval";
      tools[name] = tool({
        description: mcpTool.description,
        inputSchema: jsonSchema<Record<string, unknown>>({
          ...mcpTool.inputSchema,
          properties: mcpTool.inputSchema.properties ?? {},
        } as JSONSchema7),
        execute: async (input, { abortSignal }): Promise<string> => {
          let result: CallToolResult;
          try {
            const mcp = await openClient();
            result = await mcp.callTool({
              name: mcpTool.name,
              arguments: input,
              options: { signal: abortSignal, timeout: TOOL_CALL_TIMEOUT_MS },
            });
          } catch (error) {
            throw new Error(
              await callFailedMessage(ctx, connector, connection, error),
            );
          }
          const text = resultText(result);
          if (!result.isError) return wrapResult(connector, text);
          if (isUnknownTool(text)) {
            await scheduleToolListRefresh(ctx, connection);
          }
          throw new Error(
            `${connector.name} returned an error.\n${wrapResult(connector, text)}`,
          );
        },
      });
    }
  }

  return {
    tools,
    toolApproval,
    close: async () => {
      await Promise.allSettled(
        opened.map(async (client) => await (await client).close()),
      );
    },
  };
}

/**
 * The tools with the mentioned connectors' tools moved to the front, so the
 * model sees them before a8's own tools and other connectors' (ADR 0005).
 */
export function mentionedToolsFirst(
  tools: ToolSet,
  mentioned: Connector[],
): ToolSet {
  const isMentioned = ([name]: [string, unknown]) => {
    const connector = findConnectorTool(name)?.connector;
    return connector !== undefined && mentioned.includes(connector);
  };
  const entries = Object.entries(tools);
  return Object.fromEntries([
    ...entries.filter(isMentioned),
    ...entries.filter((entry) => !isMentioned(entry)),
  ]);
}

/** The cached tools on the connector's allowlist, which a reply offers. */
function allowedTools(connector: Connector, toolList: string): McpTool[] {
  const allowed = new Set(connector.toolAllowlist.map((entry) => entry.name));
  return (JSON.parse(toolList) as McpTool[]).filter((mcpTool) =>
    allowed.has(mcpTool.name),
  );
}

/**
 * Whether a tool is a read, which runs without approval. That's only when
 * the server marks it read-only and the connector doesn't force approval on
 * it (ADR 0005). Every other tool is an action.
 */
function isRead(connector: Connector, mcpTool: McpTool): boolean {
  return (
    mcpTool.annotations?.readOnlyHint === true &&
    !connector.toolsNeedingApproval.includes(mcpTool.name)
  );
}

async function scheduleToolListRefresh(
  ctx: ActionCtx,
  connection: Doc<"connections">,
) {
  await ctx.scheduler.runAfter(0, internal.connectors.refreshToolList, {
    connectionId: connection._id,
  });
}

/**
 * The tool error the model gets when a call doesn't reach a result. When
 * the server didn't know the tool, this also schedules a tool list refresh.
 */
async function callFailedMessage(
  ctx: ActionCtx,
  connector: Connector,
  connection: Doc<"connections">,
  error: unknown,
): Promise<string> {
  const status = MCPClientError.isInstance(error) ? error.statusCode : undefined;
  if (status === 401 || status === 403) {
    return `${connector.name} refused a8's access. Tell the user ${connector.name} needs reconnecting on the Connectors page.`;
  }
  if (isUnknownTool(error instanceof Error ? error.message : String(error))) {
    await scheduleToolListRefresh(ctx, connection);
    return `${connector.name} no longer has this tool. Answer without it.`;
  }
  console.error(`Calling a ${connector.name} tool failed`, error);
  return `Calling ${connector.name} failed. Tell the user ${connector.name} couldn't be reached, and answer without it.`;
}

/** Whether an error says the server doesn't know the tool. */
function isUnknownTool(text: string): boolean {
  return /unknown tool|tool\b.*\bnot found/i.test(text);
}

/** A tool result as text: its text parts, or JSON for anything else. */
function resultText(result: CallToolResult): string {
  const content = "content" in result ? result.content : undefined;
  if (!Array.isArray(content)) {
    const data =
      "structuredContent" in result ? result.structuredContent : result;
    return JSON.stringify(data);
  }
  return (content as Array<{ type: string; text?: unknown }>)
    .map((part) => {
      if (part.type === "text" && typeof part.text === "string") {
        return part.text;
      }
      if (part.type === "image") return "[image]";
      return JSON.stringify(part);
    })
    .join("\n\n");
}

/** The text cut to MAX_RESULT_BYTES, and whether it was cut. */
function capResult(text: string): { text: string; cut: boolean } {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= MAX_RESULT_BYTES) return { text, cut: false };
  // A cut through a character decodes to U+FFFD, which is dropped.
  const kept = new TextDecoder()
    .decode(bytes.slice(0, MAX_RESULT_BYTES))
    .replace(/�$/, "");
  return { text: kept, cut: true };
}

/**
 * The result as the model sees it: cut to about 20 KB, inside a tag that
 * marks it as data from the app, not instructions. A closing tag inside
 * the result is escaped, so the result can't end the tag early.
 */
function wrapResult(connector: Connector, text: string): string {
  const { text: kept, cut } = capResult(text);
  const escaped = kept.replace(
    new RegExp(`</${UNTRUSTED_TAG}`, "gi"),
    `<\\/${UNTRUSTED_TAG}`,
  );
  const wrapped = `<${UNTRUSTED_TAG} source="${connector.name}">\n${escaped}\n</${UNTRUSTED_TAG}>`;
  if (!cut) return wrapped;
  return `${wrapped}\n[a8 cut this result off at about 20 KB. You haven't seen the rest.]`;
}
