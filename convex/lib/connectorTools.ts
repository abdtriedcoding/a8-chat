// A reply's connector tools (ADR 0003, ADR 0005). toolLoading.ts picks
// which of them the reply loads (ADR 0006). They're built from each
// connection's cached tool list, so building them sends nothing to the
// vendor. A connector's MCP client opens on the first call to one of its
// tools in the reply, and the reply closes it when it ends. A call the
// vendor refuses with a 401 refreshes the token and runs once more. A 403
// means the connection needs reconnecting.

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
import type { ConnectionTokens } from "../connectorStore";
import { limitConnectorToolCall } from "../rateLimits";
import {
  connectionAccessToken,
  type AccessTokenResult,
} from "./connectionTokens";
import { openMcpClient } from "./connectorAuth";
import type { McpTool } from "./connectorToolList";
import {
  findConnector,
  modelToolName,
  ReconnectError,
  type Connector,
  type ConnectorTool,
} from "./connectors";
import { estimateToolTokens, type ConnectorToolGroup } from "./toolLoading";

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
 * connections get tools, and only the allowlisted ones. A tool list over a
 * day old is used as is, and a fresh one is fetched in the background for
 * later replies. Each call counts against the user's daily connector tool
 * call limit first.
 */
export async function createConnectorTools(
  ctx: ActionCtx,
  connections: Doc<"connections">[],
): Promise<ConnectorTools> {
  const groups: ConnectorToolGroup[] = [];
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

    const tools: ToolSet = {};
    let estimatedTokens = 0;
    const allowed = allowedTools(connector, connection.toolList);
    for (const { entry, mcpTool } of allowed) {
      const name = modelToolName(connector, mcpTool.name);
      if (!isRead(entry, mcpTool)) toolApproval[name] = "user-approval";
      estimatedTokens += estimateToolTokens({
        name,
        description: mcpTool.description,
        inputSchema: mcpTool.inputSchema,
      });
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
            if (error instanceof ReconnectError) throw error;
            throw new Error(
              await callFailedMessage(ctx, connector, connection, error),
            );
          }
          const text = resultText(result);
          if (!result.isError) return wrapResult(connector, text);
          await refreshIfUnknownTool(ctx, connection, text);
          throw new Error(
            `${connector.name} returned an error.\n${wrapResult(connector, text)}`,
          );
        },
      });
    }
    groups.push({ connector, tools, estimatedTokens });
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
 * Thrown when the vendor refuses the access token at `tokenVersion`, with
 * a 401 or a 403.
 */
class RefusedTokenError extends Error {
  constructor(
    readonly tokenVersion: number,
    readonly status: 401 | 403,
  ) {
    super("The vendor refused the access token.");
  }
}

/**
 * One connection's MCP client in a reply. It opens on the first call, with
 * the access token refreshed first if it's about to expire. When the vendor
 * refuses the token with a 401, it refreshes it and tries the call once
 * more. If the refresh is refused, the vendor refuses the new token too, or
 * it answers 403, the connection needs reconnecting, and every later call
 * throws ReconnectError. If the vendor couldn't be reached for the refresh,
 * every later call in the reply fails without trying it again.
 */
class ReplyConnection {
  private tokens: ConnectionTokens;
  private client?: Promise<VersionedClient>;
  private readonly opened: Promise<VersionedClient>[] = [];
  private needsReconnect = false;
  /** Whether getting the access token threw, like when a refresh failed. */
  private tokenFailed = false;

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
      // A refresh keeps the token's access, so it can't fix a 403.
      if (error.status === 403) {
        throw await this.markNeedsReconnect(error.tokenVersion);
      }
      try {
        return await this.callOnce(request, error.tokenVersion);
      } catch (retryError) {
        if (!(retryError instanceof RefusedTokenError)) throw retryError;
        // The vendor refused a token a8 just refreshed.
        throw await this.markNeedsReconnect(retryError.tokenVersion);
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
   * shares it, and the next call opens another. If getting the access token
   * failed, every later call throws without trying again.
   */
  private async connect(refusedVersion?: number): Promise<VersionedClient> {
    if (this.needsReconnect) throw new ReconnectError(this.connector);
    if (this.tokenFailed) {
      throw new Error(
        `Getting the ${this.connector.name} access token failed earlier in this reply.`,
      );
    }
    let token: AccessTokenResult;
    try {
      token = await connectionAccessToken(
        this.ctx,
        this.connector,
        this.tokens,
        { refused: this.tokens.tokenVersion === refusedVersion },
      );
    } catch (error) {
      // Trying again on every step would claim the refresh lease and call
      // the vendor each time, so later calls in the reply fail at once.
      this.tokenFailed = true;
      throw error;
    }
    if ("needsReconnect" in token) throw this.giveUp();
    this.tokens = token.tokens;
    const { tokenVersion } = token.tokens;
    try {
      const mcp = await openMcpClient(this.connector, token.accessToken);
      return { tokenVersion, mcp };
    } catch (error) {
      throw asRefusedToken(error, tokenVersion);
    }
  }

  /**
   * Marks the connection as needing reconnecting, unless its tokens changed
   * since `tokenVersion`, and gives up on it for the rest of the reply.
   */
  private async markNeedsReconnect(
    tokenVersion: number,
  ): Promise<ReconnectError> {
    await this.ctx.runMutation(internal.connectorStore.settleTokens, {
      connectionId: this.tokens._id,
      tokenVersion,
      outcome: { kind: "rejected" },
    });
    return this.giveUp();
  }

  /** Gives up on the connection for the rest of the reply. */
  private giveUp(): ReconnectError {
    this.needsReconnect = true;
    return new ReconnectError(this.connector);
  }

  async close() {
    await Promise.allSettled(
      this.opened.map(async (client) => await (await client).mcp.close()),
    );
  }
}

/**
 * RefusedTokenError if the vendor refused the access token at
 * `tokenVersion` with a 401 or a 403, or else the error as it is.
 */
function asRefusedToken(error: unknown, tokenVersion: number): unknown {
  if (!MCPClientError.isInstance(error)) return error;
  const status = error.statusCode;
  return status === 401 || status === 403
    ? new RefusedTokenError(tokenVersion, status)
    : error;
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

/**
 * Asks for the connection's tool list to be fetched again in the
 * background. requestToolListRefresh does nothing if a refresh was asked
 * for in the last few minutes.
 */
async function scheduleToolListRefresh(
  ctx: ActionCtx,
  connection: Doc<"connections">,
) {
  await ctx.runMutation(internal.connectors.requestToolListRefresh, {
    connectionId: connection._id,
  });
}

/**
 * Whether an error from the server says it doesn't know the tool. If so,
 * the cached tool list is out of date, and this schedules a refresh.
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
  return `Calling ${connector.name} failed. Tell the user ${connector.name} couldn't be reached, and answer without it.`;
}

/**
 * A tool result as text: its text parts, or JSON for anything else. A
 * result with no content parts, like Airtable's, gives its structured
 * content as JSON.
 */
function resultText(result: CallToolResult): string {
  const content = "content" in result ? result.content : undefined;
  const structured =
    "structuredContent" in result ? result.structuredContent : undefined;
  if (!Array.isArray(content)) return JSON.stringify(structured ?? result);
  if (content.length === 0 && structured != null) {
    return JSON.stringify(structured);
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
