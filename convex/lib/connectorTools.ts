// Calling connectors' MCP tools. Most calls come from a reply's connector
// tools (ADR 0003, ADR 0009), which replyTools.ts hands the reply.
// toolLoading.ts decides which of them load (ADR 0006). They're built from
// each connection's stored tool list, so building them sends nothing to
// the vendor. Each of a connector's MCP servers gets a client on the first
// call to one of its tools in the reply, and the reply closes them when it
// ends. A call the vendor refuses with a 401 refreshes the token and runs
// once more. A call it refuses with a 403 fails, and the connection needs
// reconnecting only if the vendor refuses the server's tool list too. The
// other call is the account label tool, which a8 calls once after sign-in.
// Both read their results with readToolResult.

import type { CallToolResult, MCPClient } from "@ai-sdk/mcp";
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
import type { ConnectionTokens } from "../connections";
import { limitConnectorToolCall } from "../rateLimits";
import { withAccessToken } from "./connectionTokens";
import {
  labelAt,
  openMcpClient,
  refusedStatus,
  type ServerClient,
} from "./connectorAuth";
import { readStoredTools, type McpTool } from "./connectorToolList";
import {
  findAllowlistedTool,
  findConnector,
  ReconnectError,
  type Connector,
  type ConnectorServer,
  type ConnectorTool,
} from "./connectors";
import { modelToolName } from "./connectorView";
import { isMisconfigured } from "./encryption";
import type { ConnectorToolGroup } from "./toolLoading";

/** The most of a tool result the model sees, in UTF-8 bytes. */
const MAX_RESULT_BYTES = 20_000;

/** How old a stored tool list can get before a reply asks for a new one. */
const TOOL_LIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** How long one tool call can take before a8 gives up on it. */
const TOOL_CALL_TIMEOUT_MS = 60_000;

/** The tag a connector tool's result is wrapped in for the model. */
const UNTRUSTED_TAG = "untrusted-data";

/** The tool error once the user hits the daily connector tool call limit. */
const DAILY_LIMIT_REACHED =
  "The user has reached today's limit for connector tools. Tell them it resets at 00:00 UTC, and answer without connector tools.";

export type ConnectorTools = {
  /** The tools of each connected connection, in the user's connection order. */
  groups: ConnectorToolGroup[];
  /** About how many tokens every group's tool definitions take together. */
  estimatedTokens: number;
  /**
   * The reply's `toolApproval` option. It makes every action wait for the
   * user to approve it (ADR 0002, ADR 0008). Reads aren't listed, so they
   * run at once.
   */
  toolApproval: Record<string, ToolApprovalStatus>;
  /** Closes every MCP client the reply opened. Call it once the reply ends. */
  close: () => Promise<void>;
};

/**
 * The reply's tools from the user's connections. Only `connected`
 * connections get tools, and only the ones offeredTools returns. Their
 * stored tool lists load in one query, which a reply with no `connected`
 * connection skips. A tool list over a day old is used as is, and a fresh
 * one is fetched in the background for later replies. A connection with no
 * stored list gets no tools until one is fetched. Each call counts against
 * the user's daily connector tool call limit first.
 */
export async function createConnectorTools(
  ctx: ActionCtx,
  connections: Doc<"connections">[],
): Promise<ConnectorTools> {
  const groups: ConnectorToolGroup[] = [];
  const toolApproval: Record<string, ToolApprovalStatus> = {};
  const replyConnections: ReplyConnection[] = [];

  const connected = connections.flatMap((connection) => {
    const connector = findConnector(connection.connectorId);
    return connector && connection.status === "connected"
      ? [{ connector, connection }]
      : [];
  });
  const toolLists =
    connected.length === 0
      ? []
      : await ctx.runQuery(internal.toolLists.listToolLists, {
          connectionIds: connected.map(({ connection }) => connection._id),
        });

  for (const { connector, connection } of connected) {
    const toolList = toolLists.find(
      (list) => list.connectionId === connection._id,
    );
    if (!toolList || Date.now() - toolList.fetchedAt > TOOL_LIST_MAX_AGE_MS) {
      await scheduleToolListRefresh(ctx, connection);
    }
    if (!toolList) continue;
    const replyConnection = new ReplyConnection(ctx, connector, connection);
    replyConnections.push(replyConnection);

    const tools: ToolSet = {};
    const offered = offeredTools(connector, toolList.tools);
    for (const { server, entry, mcpTool } of offered) {
      const name = modelToolName(connector, server, mcpTool.name);
      if (!isRead(entry, mcpTool)) toolApproval[name] = "user-approval";
      tools[name] = tool({
        description: mcpTool.description,
        // storedToolList adds `properties`, but a list stored before it
        // existed may lack them until its next refresh.
        inputSchema: jsonSchema<Record<string, unknown>>({
          ...mcpTool.inputSchema,
          properties: mcpTool.inputSchema.properties ?? {},
        } as JSONSchema7),
        execute: async (input, { abortSignal }): Promise<string> => {
          if (!(await limitConnectorToolCall(ctx, connection.userId))) {
            throw new Error(DAILY_LIMIT_REACHED);
          }
          let result: CallToolResult;
          try {
            result = await replyConnection.callTool(server, {
              name: mcpTool.name,
              arguments: input,
              options: { signal: abortSignal, timeout: TOOL_CALL_TIMEOUT_MS },
            });
          } catch (error) {
            if (error instanceof ReconnectError) throw error;
            throw new Error(
              await callFailedMessage(ctx, connector, connection, error),
            );
          }
          const { text } = readToolResult(result);
          if (!result.isError) return wrapResult(connector, text);
          await refreshIfUnknownTool(ctx, connection, text);
          throw new Error(
            `${connector.name} returned an error.\n${wrapResult(connector, text)}`,
          );
        },
      });
    }
    // Counted when the list was stored. Until the next refresh, it still
    // counts a tool the allowlist has since dropped.
    groups.push({
      connector,
      tools,
      estimatedTokens: toolList.estimatedTokens,
    });
  }

  return {
    groups,
    estimatedTokens: groups.reduce(
      (sum, group) => sum + group.estimatedTokens,
      0,
    ),
    toolApproval,
    close: async () => {
      await Promise.allSettled(
        replyConnections.map(async (connection) => await connection.close()),
      );
    },
  };
}

type CallToolRequest = Parameters<MCPClient["callTool"]>[0];

/** An MCP client, and the version of the tokens it sends. */
type VersionedClient = { tokenVersion: number; mcp: MCPClient };

/**
 * Thrown when the vendor refuses one tool call with a 403 but still lists
 * the server's tools with the same token. The token may lack that tool's
 * scope, or the user's plan may lack that tool's feature, so the
 * connection stays connected.
 */
class RefusedToolError extends Error {
  constructor(connector: Connector) {
    super(
      `${connector.name} refused this tool call. The user's account may lack a permission or a plan feature this tool needs. Tell the user, and answer without this tool.`,
    );
  }
}

/**
 * One connection's MCP clients in a reply, one per server. A server's
 * client opens on the first call to one of its tools. withAccessToken
 * gives each call its access token, refreshing it when it's about to
 * expire, or after the vendor refuses it with a 401, and trying the call
 * once more. A client that sends refused tokens is replaced by one with the
 * refreshed ones. When the vendor refuses a call with a 403, a8 lists the
 * server's tools with the same token. If the list works, only that call
 * fails, with RefusedToolError. If the list is refused too, the connection
 * needs reconnecting. It also needs reconnecting when the vendor refuses
 * the refresh or the refreshed token, or answers 403 to opening a client.
 * Every later call then throws ReconnectError.
 *
 * If the vendor couldn't be reached for the refresh, every later call in
 * the reply fails without trying it again.
 */
class ReplyConnection {
  private tokens: ConnectionTokens;
  /** The latest client of each server, by server key. */
  private readonly clients = new Map<string, Promise<VersionedClient>>();
  private readonly opened: Promise<VersionedClient>[] = [];
  private needsReconnect = false;
  /** What getting the access token threw, like when a refresh failed. */
  private tokenError?: Error;

  constructor(
    private readonly ctx: ActionCtx,
    private readonly connector: Connector,
    connection: Doc<"connections">,
  ) {
    this.tokens = connection;
  }

  async callTool(
    server: ConnectorServer,
    request: CallToolRequest,
  ): Promise<CallToolResult> {
    if (this.needsReconnect) throw new ReconnectError(this.connector);
    // Trying again on every call would claim the refresh lease and call
    // the vendor each time, so later calls in the reply fail at once.
    if (this.tokenError) throw this.tokenError;
    let runError: unknown;
    let result;
    try {
      result = await withAccessToken(
        this.ctx,
        this.connector,
        this.tokens,
        async (accessToken, tokens) => {
          this.tokens = tokens;
          try {
            const { mcp } = await this.open(
              server,
              accessToken,
              tokens.tokenVersion,
            );
            return await this.callOnce(mcp, request);
          } catch (error) {
            runError = error;
            throw error;
          }
        },
      );
    } catch (error) {
      if (error !== runError) {
        this.tokenError =
          error instanceof Error ? error : new Error(String(error));
      }
      throw error;
    }
    if ("needsReconnect" in result) {
      this.needsReconnect = true;
      throw new ReconnectError(this.connector);
    }
    return result.value;
  }

  private async callOnce(
    mcp: MCPClient,
    request: CallToolRequest,
  ): Promise<CallToolResult> {
    try {
      return await mcp.callTool(request);
    } catch (error) {
      if (
        refusedStatus(error) === 403 &&
        !(await refusesToolList(mcp, request.options))
      ) {
        throw new RefusedToolError(this.connector);
      }
      throw error;
    }
  }

  /**
   * The server's open client at `tokenVersion`, or a new one with
   * `accessToken`. Calls to one server running at once share a client. A
   * client that fails to open throws on every call that shares it, and the
   * next call opens another.
   */
  private async open(
    server: ConnectorServer,
    accessToken: string,
    tokenVersion: number,
  ): Promise<VersionedClient> {
    const opening = this.clients.get(server.key);
    const current = await opening?.catch(() => undefined);
    if (current && current.tokenVersion === tokenVersion) return current;
    // Another call may have started a new client while this one waited.
    const latest = this.clients.get(server.key);
    if (latest && latest !== opening) return await latest;
    const client = openMcpClient(this.connector, server, accessToken).then(
      (mcp) => ({ tokenVersion, mcp }),
    );
    this.clients.set(server.key, client);
    this.opened.push(client);
    return await client;
  }

  async close() {
    await Promise.allSettled(
      this.opened.map(async (client) => await (await client).mcp.close()),
    );
  }
}

/**
 * Whether the vendor refuses the client's token for the first page of the
 * server's tool list, with a 401 or a 403. Only then does a tool call's 403
 * mean the token has no access. Throws if the list fails another way.
 */
async function refusesToolList(
  mcp: MCPClient,
  options: CallToolRequest["options"],
): Promise<boolean> {
  try {
    await mcp.listTools({ options });
    return false;
  } catch (error) {
    if (refusedStatus(error)) return true;
    throw error;
  }
}

/**
 * The stored tools a reply offers, each with its server and allowlist
 * entry: the allowlisted ones, and every one from a server without an
 * allowlist, which has no entry.
 */
function offeredTools(
  connector: Connector,
  toolList: string,
): { server: ConnectorServer; entry?: ConnectorTool; mcpTool: McpTool }[] {
  return readStoredTools(connector, toolList).flatMap(({ server, tool }) => {
    if (!server.tools) return [{ server, mcpTool: tool }];
    const entry = server.tools.get(tool.name);
    return entry ? [{ server, entry, mcpTool: tool }] : [];
  });
}

/**
 * Whether a tool is a read, which runs without approval. The allowlist's
 * `kind` decides, and the server's `readOnlyHint` can only make a tool
 * stricter. A read asks anyway when the server marks it not read-only. An
 * action asks even when the server marks it read-only, and so does every
 * tool from a server without an allowlist (ADR 0008).
 */
function isRead(entry: ConnectorTool | undefined, mcpTool: McpTool): boolean {
  return entry?.kind === "read" && mcpTool.annotations?.readOnlyHint !== false;
}

/**
 * Asks for the connection's tool list to be fetched again in the
 * background. requestToolListRefresh does nothing if a refresh was asked
 * for in the last few minutes.
 */
async function scheduleToolListRefresh(
  ctx: ActionCtx,
  connection: Doc<"connections">,
) {
  await ctx.runMutation(internal.toolLists.requestToolListRefresh, {
    connectionId: connection._id,
  });
}

/**
 * Whether an error from the server says it doesn't know the tool. If so,
 * the stored tool list is out of date, and this schedules a refresh.
 */
async function refreshIfUnknownTool(
  ctx: ActionCtx,
  connection: Doc<"connections">,
  errorText: string,
): Promise<boolean> {
  if (!/unknown tool|tool\b.*\bnot found/i.test(errorText)) return false;
  await scheduleToolListRefresh(ctx, connection);
  return true;
}

/**
 * The tool error the model gets when a call doesn't reach a result. When
 * the server didn't know the tool, this also schedules a tool list refresh.
 * When the vendor refused only this tool, it passes on RefusedToolError's
 * message. When the deployment is set up wrong, like with another
 * CONNECTION_ENCRYPTION_KEY, it passes on the MISCONFIGURED message.
 */
async function callFailedMessage(
  ctx: ActionCtx,
  connector: Connector,
  connection: Doc<"connections">,
  error: unknown,
): Promise<string> {
  const message = error instanceof Error ? error.message : String(error);
  if (await refreshIfUnknownTool(ctx, connection, message)) {
    return `${connector.name} no longer has this tool. Answer without it.`;
  }
  console.error(`Calling a ${connector.name} tool failed`, error);
  if (error instanceof RefusedToolError) return error.message;
  if (isMisconfigured(error)) {
    return `Calling ${connector.name} failed: ${error.data.message} Reconnecting ${connector.name} won't fix it. Tell the user, and answer without it.`;
  }
  return `Calling ${connector.name} failed. Tell the user ${connector.name} couldn't be reached, and answer without it.`;
}

/** How long the account label tool can take before a8 gives up on it. */
const ACCOUNT_LABEL_TIMEOUT_MS = 15_000;

/**
 * Calls the connector's account label tool once, right after sign-in, and
 * returns the label from its result. Undefined if the connector's label
 * doesn't come from a tool, the tool isn't an allowlisted read, or the call
 * or its result fails.
 */
export async function readAccountLabel(
  connector: Connector,
  clients: ServerClient[],
): Promise<string | undefined> {
  const source = connector.accountLabel;
  if (source?.from !== "tool") return undefined;
  // a8 calls it without asking, so only an allowlisted read qualifies.
  const found = findAllowlistedTool(connector, source.tool);
  const client = clients.find(({ server }) => server === found?.server);
  if (found?.tool.kind !== "read" || !client) {
    console.error(
      `${connector.name}'s account label tool ${source.tool} isn't an allowlisted read.`,
    );
    return undefined;
  }
  try {
    const result = await client.mcp.callTool({
      name: source.tool,
      arguments: source.arguments ?? {},
      options: { timeout: ACCOUNT_LABEL_TIMEOUT_MS },
    });
    if (result.isError) throw new Error(JSON.stringify(result));
    return labelAt(readToolResult(result).data, source.field);
  } catch (error) {
    console.error(`Reading the ${connector.name} account label failed`, error);
    return undefined;
  }
}

type ContentPart = { type: string; text?: unknown };

/**
 * What an MCP tool result holds, read the same way for every caller:
 * - `text`: the content parts as text, joined by blank lines. A text part
 *   gives its text, an image "[image]", and any other part its JSON. A
 *   result with no content parts, like Airtable's, gives its structured
 *   content as JSON. Tool calls send this to the model.
 * - `data`: the structured content, or else the first text part parsed as
 *   JSON. Undefined if there's neither. The account label is read from
 *   this.
 */
export function readToolResult(result: CallToolResult): {
  text: string;
  data: unknown;
} {
  const content =
    "content" in result && Array.isArray(result.content)
      ? (result.content as ContentPart[])
      : undefined;
  const structured =
    "structuredContent" in result ? result.structuredContent : undefined;
  return {
    text: resultText(result, content, structured),
    data: resultData(content, structured),
  };
}

function resultText(
  result: CallToolResult,
  content: ContentPart[] | undefined,
  structured: unknown,
): string {
  if (!content) return JSON.stringify(structured ?? result);
  if (content.length === 0 && structured != null) {
    return JSON.stringify(structured);
  }
  return content
    .map((part) => {
      const text = textOf(part);
      if (text !== undefined) return text;
      if (part.type === "image") return "[image]";
      return JSON.stringify(part);
    })
    .join("\n\n");
}

function resultData(
  content: ContentPart[] | undefined,
  structured: unknown,
): unknown {
  if (structured) return structured;
  const text = content?.map(textOf).find((text) => text !== undefined);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** A content part's text, or undefined if it isn't a text part. */
function textOf(part: ContentPart): string | undefined {
  return part.type === "text" && typeof part.text === "string"
    ? part.text
    : undefined;
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
