// What a8 stores of a connector's MCP servers' tool lists, in the
// connection's connectionToolLists row. Vendor lists go to the model as
// tool definitions, so a8 checks them here first. One vendor's long
// description or odd schema mustn't break every reply, and a long list
// mustn't pass Convex's 1 MB document limit.

import type { ListToolsResult } from "@ai-sdk/mcp";
import type { Connector, ConnectorServer } from "./connectors";
import { modelToolName } from "./connectorView";
import { estimateToolTokens } from "./toolLoading";

export type McpTool = ListToolsResult["tools"][number];

/** A tool as a8 stores it, with the key of the server that listed it. */
export type StoredTool = McpTool & { server: string };

/** One server's tools, as the server listed them. */
export type ServerTools = { server: ConnectorServer; tools: McpTool[] };

/** A tool list as a8 stores it. */
export type StoredToolList = {
  /**
   * The tools as JSON, a StoredTool array. Stored as a string because JSON
   * Schema keys like "$schema" aren't valid Convex field names.
   */
  tools: string;
  /** About how many tokens the tools' definitions take (estimateToolTokens). */
  estimatedTokens: number;
};

/** The longest description a8 stores, in characters. */
const MAX_DESCRIPTION_CHARS = 2_048;

/** The most tools a stored list keeps. */
const MAX_TOOLS = 100;

/** The largest stored list, in UTF-8 bytes of JSON. */
const MAX_TOOL_LIST_BYTES = 500_000;

/**
 * The tools a8 stores from each of the connector's servers (capToolList):
 * the ones on the server's allowlist, or every one from a server without
 * an allowlist, like a custom connector's (#124).
 */
export function storedToolList(
  connector: Connector,
  listed: ServerTools[],
): StoredToolList {
  return capToolList(
    connector,
    listed.flatMap(({ server, tools }) =>
      tools
        .filter((tool) => !server.tools || server.tools.has(tool.name))
        .map((tool) => ({ server, tool })),
    ),
  );
}

/**
 * The tools as a8 stores them, with their token estimate. Each tool keeps
 * its server's key, its name, description, input schema and annotations.
 * a8 cuts each description to MAX_DESCRIPTION_CHARS and makes each input
 * schema an object schema (toObjectSchema). The list keeps at most
 * MAX_TOOLS tools and MAX_TOOL_LIST_BYTES bytes, in server order and then
 * in each server's order. a8 skips a tool that doesn't fit.
 */
function capToolList(
  connector: Connector,
  tools: { server: ConnectorServer; tool: McpTool }[],
): StoredToolList {
  const encoder = new TextEncoder();
  const kept: string[] = [];
  let estimatedTokens = 0;
  // The list starts with the two bytes of its brackets.
  let bytes = 2;
  for (const { server, tool } of tools) {
    if (kept.length === MAX_TOOLS) break;
    const stored = storedTool(server, tool);
    const json = JSON.stringify(stored);
    // Every tool but the first adds a comma.
    const size = encoder.encode(json).length + (kept.length > 0 ? 1 : 0);
    if (bytes + size > MAX_TOOL_LIST_BYTES) continue;
    kept.push(json);
    bytes += size;
    // The same definition a reply sends the model (createConnectorTools).
    estimatedTokens += estimateToolTokens({
      name: modelToolName(connector, server, stored.name),
      description: stored.description,
      inputSchema: stored.inputSchema,
    });
  }
  if (kept.length < tools.length) {
    console.warn(
      `Stored ${kept.length} of ${connector.name}'s ${tools.length} tools, ${bytes} bytes.`,
    );
  }
  return { tools: `[${kept.join(",")}]`, estimatedTokens };
}

/**
 * The stored tools of a connection to the connector, each with its server.
 * A tool whose server the connector no longer has is left out.
 */
export function readStoredTools(
  connector: Connector,
  tools: string,
): { server: ConnectorServer; tool: McpTool }[] {
  const servers = new Map(
    connector.servers.map((server) => [server.key, server]),
  );
  return (JSON.parse(tools) as StoredTool[]).flatMap(
    ({ server: key, ...tool }) => {
      const server = servers.get(key);
      return server ? [{ server, tool }] : [];
    },
  );
}

function storedTool(server: ConnectorServer, tool: McpTool): StoredTool {
  return {
    server: server.key,
    name: tool.name,
    description: tool.description && cutDescription(tool.description),
    inputSchema: toObjectSchema(tool.inputSchema),
    annotations: isObject(tool.annotations) ? tool.annotations : undefined,
  };
}

function cutDescription(description: string): string {
  if (description.length <= MAX_DESCRIPTION_CHARS) return description;
  // A cut between a surrogate pair leaves half a character, which is dropped.
  return description
    .slice(0, MAX_DESCRIPTION_CHARS)
    .replace(/[\uD800-\uDBFF]$/, "")
    .trimEnd();
}

/**
 * An input schema the model provider accepts: `type: "object"` with a
 * `properties` object, and no anyOf, oneOf or allOf at the top, which
 * Anthropic refuses. a8 merges their variants' properties into
 * `properties`. A schema for anything but an object becomes one with no
 * properties.
 */
function toObjectSchema(schema: unknown): McpTool["inputSchema"] {
  if (!isObject(schema) || !allowsObject(schema.type)) {
    return { type: "object", properties: {} };
  }
  const { anyOf, oneOf, allOf, required: ownRequired, ...rest } = schema;
  const variants = [anyOf, oneOf, allOf].flatMap((list) =>
    Array.isArray(list) ? list.filter(isObject) : [],
  );
  const properties = Object.assign(
    {},
    ...variants.map((variant) =>
      isObject(variant.properties) ? variant.properties : {},
    ),
    isObject(rest.properties) ? rest.properties : {},
  ) as Record<string, unknown>;
  // Every allOf variant applies, so what each requires stays required.
  const required = [
    ...stringList(ownRequired),
    ...(Array.isArray(allOf) ? allOf.filter(isObject) : []).flatMap((variant) =>
      stringList(variant.required),
    ),
  ];
  return {
    ...rest,
    type: "object",
    properties,
    ...(required.length > 0 ? { required: [...new Set(required)] } : {}),
  };
}

function allowsObject(type: unknown): boolean {
  return (
    type === undefined ||
    type === "object" ||
    (Array.isArray(type) && type.includes("object"))
  );
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
