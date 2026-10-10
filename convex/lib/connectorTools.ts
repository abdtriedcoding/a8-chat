// A reply's connector tools (ADR 0003, ADR 0005). They're built from each
// connection's cached tool list, so building them sends nothing to the
// vendor. A connector's MCP client opens on the first call to one of its
// tools in the reply, and the reply closes it when it ends. A call the
// vendor refuses with a 401 refreshes the token and runs once more.

import {
  MCPClientError,
  type CallToolResult,
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
import type { ConnectionTokens } from "../connectors";
import { limitConnectorToolCall } from "../rateLimits";
import { connectionAccessToken } from "./connectionTokens";
import { createConnectorClient } from "./connectorAuth";
import type { McpTool } from "./connectorToolList";
import {
  findConnector,
  findConnectorTool,
  modelToolName,
  needsReconnectError,
  type Connector,
  type ConnectorTool,
} from "./connectors";

/** The most of a tool result the model sees, in UTF-8 bytes. */
const MAX_RESULT_BYTES = 20_000;

/** How old a cached tool list can get before a reply asks for a new one. */
const TOOL_LIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** How long one tool call can take before a8 gives up on it. */
const TOOL_CALL_TIMEOUT_MS = 60_000;

/** The tag a connector tool's result is wrapped in for the model. */
const UNTRUSTED_TAG = "untrusted-data";

/** The tool error once the user hits the daily connector tool call limit. */
const DAILY_LIMIT_REACHED =
  "The user has reached today's limit for connector tools. Tell them it resets at 00:00 UTC, and answer without connector tools.";

export type ConnectorTools = {
  /** The tools of every connected connection, named by modelToolName. */
  tools: ToolSet;
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
 * connections get tools, and only the allowlisted ones. A tool list over a
 * day old is used as is, and a fresh one is fetched in the background for
 * later replies. Each call counts against the user's daily connector tool
 * call limit first.
 */
export async function createConnectorTools(
  ctx: ActionCtx,
  connections: Doc<"connections">[],
): Promise<ConnectorTools> {
  const tools: ToolSet = {};
  const toolApproval: Record<string, ToolApprovalStatus> = {};
  const replyConnections: ReplyConnection[] = [];

  for (const connection of connections) {
    const connector = findConnector(connection.connectorId);
    if (!connector || connection.status !== "connected") continue;
    if (Date.now() - connection.toolListFetchedAt > TOOL_LIST_MAX_AGE_MS) {
      await scheduleToolListRefresh(ctx, connection);
    }
    const replyConnection = new ReplyConnection(ctx, connector, connection);
    replyConnections.push(replyConnection);

    const allowed = allowedTools(connector, connection.toolList);
    for (const { entry, mcpTool } of allowed) {
      const name = modelToolName(connector, mcpTool.name);
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
            result = await replyConnection.callTool({
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
        replyConnections.map(async (connection) => await connection.close()),
      );
    },
  };
}

type CallToolRequest = Parameters<MCPClient["callTool"]>[0];

/** An MCP client, and the version of the tokens it sends. */
type VersionedClient = { tokenVersion: number; mcp: MCPClient };

/** What a call throws once its connection needs reconnecting. */
class NeedsReconnectError extends Error {}

/** Thrown when the vendor refuses the access token at `tokenVersion`. */
class RefusedTokenError extends Error {
  constructor(readonly tokenVersion: number) {
    super("The vendor refused the access token.");
  }
}

/**
 * One connection's MCP client in a reply. It opens on the first call, with
 * the access token refreshed first if it's about to expire. When the vendor
 * refuses the token, it refreshes it and tries the call once more. If the
 * refresh is refused, or the vendor refuses the new token too, the
 * connection needs reconnecting, and every later call throws
 * NeedsReconnectError.
 */
class ReplyConnection {
  private tokens: ConnectionTokens;
  private client?: Promise<VersionedClient>;
  private readonly opened: Promise<VersionedClient>[] = [];
  private needsReconnect = false;

  constructor(
    private readonly ctx: ActionCtx,
    private readonly connector: Connector,
    connection: Doc<"connections">,
  ) {
    this.tokens = connection;
  }

  async callTool(request: CallToolRequest): Promise<CallToolResult> {
    try {
      return await this.callOnce(request);
    } catch (error) {
      if (!(error instanceof RefusedTokenError)) throw error;
      try {
        return await this.callOnce(request, error.tokenVersion);
      } catch (retryError) {
        if (!(retryError instanceof RefusedTokenError)) throw retryError;
        // The vendor refused a token a8 just refreshed.
        await this.ctx.runMutation(internal.connectors.markNeedsReconnect, {
          connectionId: this.tokens._id,
          tokenVersion: retryError.tokenVersion,
        });
        throw this.giveUp();
      }
    }
  }

  private async callOnce(
    request: CallToolRequest,
    refusedVersion?: number,
  ): Promise<CallToolResult> {
    const { tokenVersion, mcp } = await this.open(refusedVersion);
    try {
      return await mcp.callTool(request);
    } catch (error) {
      throw asRefusedToken(error, tokenVersion);
    }
  }

  /**
   * The open client, or a new one. `refusedVersion` names tokens the vendor
   * refused, so a client sending them is replaced by one with refreshed
   * tokens. Calls running at once share one client.
   */
  private async open(refusedVersion?: number): Promise<VersionedClient> {
    const opening = this.client;
    const current = await opening?.catch(() => undefined);
    if (current && current.tokenVersion !== refusedVersion) return current;
    // Another call may have started a new client while this one waited.
    if (this.client && this.client !== opening) return await this.client;
    const client = this.connect(refusedVersion);
    this.client = client;
    this.opened.push(client);
    return await client;
  }

  /**
   * Opens a client. A client that fails to open throws on every call that
   * shares it, and the next call opens another.
   */
  private async connect(refusedVersion?: number): Promise<VersionedClient> {
    if (this.needsReconnect) throw new NeedsReconnectError();
    const token = await connectionAccessToken(
      this.ctx,
      this.connector,
      this.tokens,
      { refused: this.tokens.tokenVersion === refusedVersion },
    );
    if ("needsReconnect" in token) throw this.giveUp();
    this.tokens = token.tokens;
    const { tokenVersion } = token.tokens;
    try {
      const mcp = await createConnectorClient(
        this.connector,
        token.accessToken,
      );
      return { tokenVersion, mcp };
    } catch (error) {
      throw asRefusedToken(error, tokenVersion);
    }
  }

  /** Marks the connection as needing reconnecting for the rest of the reply. */
  private giveUp(): NeedsReconnectError {
    this.needsReconnect = true;
    return new NeedsReconnectError();
  }

  async close() {
    await Promise.allSettled(
      this.opened.map(async (client) => await (await client).mcp.close()),
    );
  }
}

/**
 * RefusedTokenError if the vendor refused the access token at
 * `tokenVersion` with a 401, or else the error as it is.
 */
function asRefusedToken(error: unknown, tokenVersion: number): unknown {
  return MCPClientError.isInstance(error) && error.statusCode === 401
    ? new RefusedTokenError(tokenVersion)
    : error;
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

/**
 * The cached tools on the connector's allowlist, which a reply offers, each
 * with its allowlist entry.
 */
function allowedTools(
  connector: Connector,
  toolList: string,
): { entry: ConnectorTool; mcpTool: McpTool }[] {
  const entries = new Map(
    connector.toolAllowlist.map((entry) => [entry.name, entry]),
  );
  return (JSON.parse(toolList) as McpTool[]).flatMap((mcpTool) => {
    const entry = entries.get(mcpTool.name);
    return entry ? [{ entry, mcpTool }] : [];
  });
}

/**
 * Whether a tool is a read, which runs without approval. The allowlist's
 * `kind` decides, and the server's `readOnlyHint` can only make a tool
 * stricter. A read asks anyway when the server marks it not read-only. An
 * action asks even when the server marks it read-only (ADR 0008).
 */
function isRead(entry: ConnectorTool, mcpTool: McpTool): boolean {
  return entry.kind === "read" && mcpTool.annotations?.readOnlyHint !== false;
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
  if (error instanceof NeedsReconnectError) {
    return needsReconnectError(connector);
  }
  const status = MCPClientError.isInstance(error) ? error.statusCode : undefined;
  if (status === 403) {
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
