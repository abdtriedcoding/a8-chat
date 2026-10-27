// Tool lists: the tools a8 stores for each connection, in connectionToolLists.
// saveConnection schedules the first fetch, refreshToolList. A reply
// builds its tools from the stored list without calling the vendor, and asks
// for a refresh when the list is a day old or the server didn't know a tool.

import type { MCPClient } from "@ai-sdk/mcp";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  pinnedFetch,
  readUserAccount,
  withMcpClients,
  withoutFailedServers,
  type Account,
  type ServerClient,
} from "./lib/connectorAuth";
import {
  storedToolList,
  type McpTool,
  type StoredToolList,
} from "./lib/connectorToolList";
import { withAccessToken } from "./lib/connectionTokens";
import { readAccountLabel } from "./lib/connectorTools";
import { findConnector, type Connector } from "./lib/connectors";
import { vAppInstallCheck, type AppInstallCheck } from "./schema";

/**
 * How long after a tool list refresh is scheduled before another can be.
 * It's long enough that a vendor outage doesn't make every reply try again.
 */
const TOOL_LIST_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;

/** A tool list as saveConnection and saveToolList take it. */
export const vStoredToolList = v.object({
  tools: v.string(),
  estimatedTokens: v.number(),
  stale: v.optional(v.boolean()),
});

/**
 * The stored tool lists of the connections. A connection with no stored
 * list is left out. A reply reads them for its `connected` connections
 * (getReplyStart), and builds its tools from them (createConnectorTools).
 */
export async function readToolLists(
  ctx: QueryCtx,
  connectionIds: Id<"connections">[],
): Promise<Doc<"connectionToolLists">[]> {
  const toolLists = await Promise.all(
    connectionIds.map(async (id) => await findToolList(ctx, id)),
  );
  return toolLists.filter((toolList) => toolList !== null);
}

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
    const connection = await ctx.runQuery(internal.connections.getConnection, {
      by: { connectionId },
    });
    const connector = connection && findConnector(connection.connectorId);
    if (connection?.status !== "connected" || !connector) return null;
    // Reads the account label while a client is open, if sign-in found none.
    const needsLabel = connection.accountLabel === undefined;
    const result = await withAccessToken(
      ctx,
      connector,
      connection,
      async (accessToken) =>
        await readToolList(connector, accessToken, { needsLabel }),
    );
    if ("needsReconnect" in result) return null;
    const { toolList, accountLabel, accountAvatarUrl, appInstall } =
      result.value;
    await ctx.runMutation(internal.toolLists.saveToolList, {
      connectionId,
      connectedAt: connection.connectedAt,
      toolList,
      accountLabel,
      accountAvatarUrl,
      appInstall,
    });
    return null;
  },
});

/**
 * Checks only whether the connection's app is installed (readAppInstall),
 * without fetching its tool list, and stores what it found. Does nothing
 * for a connection that's gone or needs reconnecting, or whose connector
 * has no app to install.
 */
export async function checkConnectionAppInstall(
  ctx: ActionCtx,
  connectionId: Id<"connections">,
) {
  const connection = await ctx.runQuery(internal.connections.getConnection, {
    by: { connectionId },
  });
  const connector = connection && findConnector(connection.connectorId);
  if (connection?.status !== "connected" || !connector?.appInstall) return;
  const result = await withAccessToken(
    ctx,
    connector,
    connection,
    async (accessToken) => await readAppInstall(connector, accessToken),
  );
  if ("needsReconnect" in result || result.value === undefined) return;
  await ctx.runMutation(internal.toolLists.saveAppInstall, {
    connectionId,
    connectedAt: connection.connectedAt,
    appInstall: result.value,
  });
}

/**
 * Stores a new tool list for the connection, if it still exists and wasn't
 * replaced since `connectedAt`. A reconnect keeps the row's ID but stores
 * its own list, which an older refresh mustn't overwrite. A token refresh
 * keeps `connectedAt`, so it doesn't stop the write. Also stores
 * `accountLabel` and `accountAvatarUrl` if the connection has no label,
 * and what the app install check found.
 */
export const saveToolList = internalMutation({
  args: {
    connectionId: v.id("connections"),
    connectedAt: v.number(),
    toolList: vStoredToolList,
    accountLabel: v.optional(v.string()),
    accountAvatarUrl: v.optional(v.string()),
    appInstall: v.optional(vAppInstallCheck),
  },
  returns: v.null(),
  handler: async (
    ctx,
    {
      connectionId,
      connectedAt,
      toolList,
      accountLabel,
      accountAvatarUrl,
      appInstall,
    },
  ) => {
    const connection = await ctx.db.get("connections", connectionId);
    if (connection?.connectedAt !== connectedAt) return null;
    if (accountLabel !== undefined && connection.accountLabel === undefined) {
      await ctx.db.patch("connections", connectionId, {
        accountLabel,
        accountAvatarUrl,
      });
    }
    if (appInstall !== undefined) {
      await storeAppInstall(ctx, connectionId, appInstall);
    }
    await writeToolList(ctx, connectionId, toolList);
    return null;
  },
});

/**
 * Stores what checkConnectionAppInstall found, if the connection still
 * exists and wasn't replaced since `connectedAt`, like saveToolList.
 */
export const saveAppInstall = internalMutation({
  args: {
    connectionId: v.id("connections"),
    connectedAt: v.number(),
    appInstall: vAppInstallCheck,
  },
  returns: v.null(),
  handler: async (ctx, { connectionId, connectedAt, appInstall }) => {
    const connection = await ctx.db.get("connections", connectionId);
    if (connection?.connectedAt !== connectedAt) return null;
    await storeAppInstall(ctx, connectionId, appInstall);
    return null;
  },
});

async function storeAppInstall(
  ctx: MutationCtx,
  connectionId: Id<"connections">,
  appInstall: AppInstallCheck,
) {
  await ctx.db.patch("connections", connectionId, {
    appInstall: appInstall === "installed" ? undefined : appInstall,
  });
}

/**
 * Stores the connection's tool list, fetched now. A `stale` list is stored
 * as never fetched, so the next reply asks for a refresh. Keeps the time a
 * refresh was last requested, so the cooldown still applies.
 */
export async function writeToolList(
  ctx: MutationCtx,
  connectionId: Id<"connections">,
  { stale, ...toolList }: StoredToolList,
) {
  const existing = await findToolList(ctx, connectionId);
  const row = { ...toolList, fetchedAt: stale ? 0 : Date.now() };
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
 * Every tool the connector's MCP servers list, across all pages, as a8
 * stores them (storedToolList). Takes the clients withMcpClients opened. A
 * server that failed to open or to list is left out (withoutFailedServers),
 * and the list is `stale`.
 */
async function fetchToolList(
  connector: Connector,
  clients: ServerClient[],
): Promise<StoredToolList> {
  const listed = withoutFailedServers(
    await Promise.allSettled(
      clients.map(async ({ server, mcp }) => ({
        server,
        tools: await listAllTools(mcp),
      })),
    ),
  );
  const toolList = storedToolList(connector, listed);
  return listed.length < connector.servers.length
    ? { ...toolList, stale: true }
    : toolList;
}

async function listAllTools(client: MCPClient): Promise<McpTool[]> {
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools({
      params: cursor === undefined ? undefined : { cursor },
    });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return tools;
}

/**
 * The connector's tool list (fetchToolList), read with `accessToken`, its
 * account (readAccount) if `needsLabel`, and whether its app is installed
 * (readAppInstall). A connector with no sign-in has no token to pass.
 */
export async function readToolList(
  connector: Connector,
  accessToken: string | undefined,
  { needsLabel }: { needsLabel: boolean },
): Promise<
  Account & {
    toolList: StoredToolList;
    appInstall: AppInstallCheck | undefined;
  }
> {
  return await withMcpClients(connector, accessToken, async (clients) => ({
    toolList: await fetchToolList(connector, clients),
    ...(needsLabel ? await readAccount(connector, clients, accessToken) : {}),
    appInstall: await readAppInstall(connector, accessToken),
  }));
}

/**
 * The signed-in account: from a `user` source with `accessToken`
 * (readUserAccount), or else from the label tool (readAccountLabel).
 */
async function readAccount(
  connector: Connector,
  clients: ServerClient[],
  accessToken: string | undefined,
): Promise<Account> {
  if (connector.accountLabel?.from === "user") {
    return accessToken === undefined
      ? {}
      : await readUserAccount(connector, accessToken);
  }
  return { accountLabel: await readAccountLabel(connector, clients) };
}

/**
 * Whether the connection's app is installed and reaches anything, for a
 * connector with an app to install. Undefined for any other connector, or
 * when the vendor didn't answer, so the stored answer stays.
 */
async function readAppInstall(
  connector: Connector,
  accessToken: string | undefined,
): Promise<AppInstallCheck | undefined> {
  if (!connector.appInstall || accessToken === undefined) return undefined;
  try {
    return await connector.appInstall.check(
      pinnedFetch(connector),
      accessToken,
    );
  } catch (error) {
    console.error(`Checking the ${connector.name} app install failed`, error);
    return undefined;
  }
}
