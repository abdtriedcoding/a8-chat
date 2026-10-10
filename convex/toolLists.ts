// The tool cache: each connection's stored tool list, in connectionToolLists.
// finishConnect fetches the first list and saveConnection stores it. A reply
// builds its tools from the stored list without calling the vendor, and asks
// for a refresh when the list is a day old or the server didn't know a tool.

import { MCPClientError, type MCPClient } from "@ai-sdk/mcp";
import { getThreadMetadata } from "@convex-dev/agent";
import { v, type Infer } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { createConnectorClient } from "./lib/connectorAuth";
import {
  storedToolList,
  type McpTool,
  type StoredToolList,
} from "./lib/connectorToolList";
import { connectionAccessToken } from "./lib/connectionTokens";
import { CONNECTORS, findConnector, type Connector } from "./lib/connectors";
import schema from "./schema";

/**
 * How long after a tool list refresh is scheduled before another can be.
 * It's long enough that a vendor outage doesn't make every reply try again.
 */
const TOOL_LIST_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;

/** A tool list as saveConnection and saveToolList take it. */
export const vStoredToolList = v.object({
  tools: v.string(),
  estimatedTokens: v.number(),
});

const vConnectionWithToolList = v.object({
  connection: schema.doc("connections"),
  // Null if the connection has no stored list yet.
  toolList: v.union(schema.doc("connectionToolLists"), v.null()),
});

/** A connection, tokens included, with its stored tool list. */
export type ConnectionWithToolList = Infer<typeof vConnectionWithToolList>;

/**
 * The connections of the thread's owner, tokens included, each with its
 * stored tool list. streamReply builds the reply's tools from them. It runs
 * from the scheduler with no signed-in user, so the thread names the user.
 */
export const listReplyConnections = internalQuery({
  args: { threadId: v.string() },
  returns: v.array(vConnectionWithToolList),
  handler: async (ctx, { threadId }) => {
    const thread = await getThreadMetadata(ctx, components.agent, {
      threadId,
    }).catch(() => null);
    const userId = thread?.userId;
    if (!userId) return [];
    const connections = await ctx.db
      .query("connections")
      .withIndex("by_userId_and_connectorId", (q) => q.eq("userId", userId))
      .take(CONNECTORS.length);
    return await Promise.all(
      connections.map(async (connection) => ({
        connection,
        toolList: await findToolList(ctx, connection._id),
      })),
    );
  },
});

/**
 * Schedules refreshToolList for the connection, unless one was scheduled
 * in the last TOOL_LIST_REFRESH_COOLDOWN_MS. A reply calls this when the
 * stored list is over a day old or missing, or when the server didn't know
 * a tool the list had. Replies that see the same stale list at once share
 * one refresh.
 */
export const requestToolListRefresh = internalMutation({
  args: { connectionId: v.id("connections") },
  returns: v.null(),
  handler: async (ctx, { connectionId }) => {
    const connection = await ctx.db.get("connections", connectionId);
    if (connection?.status !== "connected") return null;
    const toolList = await findToolList(ctx, connectionId);
    const now = Date.now();
    const requestedAt = toolList?.refreshRequestedAt ?? 0;
    if (now - requestedAt < TOOL_LIST_REFRESH_COOLDOWN_MS) return null;
    if (toolList) {
      await ctx.db.patch("connectionToolLists", toolList._id, {
        refreshRequestedAt: now,
      });
    } else {
      // An empty list that's already stale, so the cooldown covers a
      // connection with no list too.
      await ctx.db.insert("connectionToolLists", {
        connectionId,
        tools: "[]",
        estimatedTokens: 0,
        fetchedAt: 0,
        refreshRequestedAt: now,
      });
    }
    await ctx.scheduler.runAfter(0, internal.toolLists.refreshToolList, {
      connectionId,
    });
    return null;
  },
});

/**
 * Fetches the connection's tool list again and stores it. Does nothing if
 * the connection is gone. Like a tool call, a token the vendor refuses is
 * refreshed and tried once more. If the refresh is refused, or the vendor
 * refuses the new token too, the connection needs reconnecting.
 */
export const refreshToolList = internalAction({
  args: { connectionId: v.id("connections") },
  returns: v.null(),
  handler: async (ctx, { connectionId }) => {
    const connection = await ctx.runQuery(
      internal.connectors.getConnectionById,
      { connectionId },
    );
    const connector = connection && findConnector(connection.connectorId);
    if (connection?.status !== "connected" || !connector) return null;
    let token = await connectionAccessToken(ctx, connector, connection);
    if ("needsReconnect" in token) return null;
    let toolList = await listToolsWithToken(connector, token.accessToken);
    if (toolList === 401) {
      // settleRefresh marks the connection if the vendor refuses the refresh.
      token = await connectionAccessToken(ctx, connector, token.tokens, {
        refused: true,
      });
      if ("needsReconnect" in token) return null;
      toolList = await listToolsWithToken(connector, token.accessToken);
    }
    if (typeof toolList === "number") {
      // The vendor refused a token a8 just refreshed, or answered 403.
      await ctx.runMutation(internal.connectors.markNeedsReconnect, {
        connectionId,
        tokenVersion: token.tokens.tokenVersion,
      });
      return null;
    }
    await ctx.runMutation(internal.toolLists.saveToolList, {
      connectionId,
      toolList,
    });
    return null;
  },
});

/** Stores a new tool list for the connection, if it still exists. */
export const saveToolList = internalMutation({
  args: { connectionId: v.id("connections"), toolList: vStoredToolList },
  returns: v.null(),
  handler: async (ctx, { connectionId, toolList }) => {
    if (!(await ctx.db.get("connections", connectionId))) return null;
    await writeToolList(ctx, connectionId, toolList);
    return null;
  },
});

/**
 * Stores the connection's tool list, fetched now. Keeps the time a refresh
 * was last requested, so the cooldown still applies.
 */
export async function writeToolList(
  ctx: MutationCtx,
  connectionId: Id<"connections">,
  toolList: StoredToolList,
) {
  const existing = await findToolList(ctx, connectionId);
  const row = { ...toolList, fetchedAt: Date.now() };
  if (existing) {
    await ctx.db.patch("connectionToolLists", existing._id, row);
  } else {
    await ctx.db.insert("connectionToolLists", { connectionId, ...row });
  }
}

/** Deletes the connection's tool list. Call it wherever a connection goes. */
export async function deleteToolList(
  ctx: MutationCtx,
  connectionId: Id<"connections">,
) {
  const toolList = await findToolList(ctx, connectionId);
  if (toolList) await ctx.db.delete("connectionToolLists", toolList._id);
}

async function findToolList(ctx: QueryCtx, connectionId: Id<"connections">) {
  return await ctx.db
    .query("connectionToolLists")
    .withIndex("by_connectionId", (q) => q.eq("connectionId", connectionId))
    .unique();
}

/**
 * Every tool the connector's MCP server lists, across all pages, as a8
 * stores them (storedToolList).
 */
export async function fetchToolList(
  connector: Connector,
  client: MCPClient,
): Promise<StoredToolList> {
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools({
      params: cursor === undefined ? undefined : { cursor },
    });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return storedToolList(connector, tools);
}

/**
 * The connector's tool list (fetchToolList), read with `accessToken`.
 * Returns the status if the vendor refuses the token with a 401 or 403.
 */
async function listToolsWithToken(
  connector: Connector,
  accessToken: string,
): Promise<StoredToolList | 401 | 403> {
  try {
    const client = await createConnectorClient(connector, accessToken);
    try {
      return await fetchToolList(connector, client);
    } finally {
      await client.close();
    }
  } catch (error) {
    if (MCPClientError.isInstance(error)) {
      if (error.statusCode === 401 || error.statusCode === 403) {
        return error.statusCode;
      }
    }
    throw error;
  }
}
