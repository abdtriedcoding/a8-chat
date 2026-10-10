// What a8 stores of an MCP server's tool list, on the connection. Vendor
// lists go to the model as tool definitions, so a8 checks them here first.
// One vendor's long description or odd schema mustn't break every reply,
// and a long list mustn't pass Convex's 1 MB document limit.

import type { ListToolsResult } from "@ai-sdk/mcp";
import type { Connector } from "./connectors";

export type McpTool = ListToolsResult["tools"][number];

/** The longest description a8 stores, in characters. */
const MAX_DESCRIPTION_CHARS = 2_048;

/** The most tools a stored list keeps. */
const MAX_TOOLS = 100;

/** The largest stored list, in UTF-8 bytes of JSON. */
const MAX_TOOL_LIST_BYTES = 500_000;

/**
 * The server's tools as a8 stores them, as a JSON string. Each tool keeps
 * its name, description, input schema and annotations. a8 cuts each
 * description to MAX_DESCRIPTION_CHARS and makes each input schema an
 * object schema (toObjectSchema). The list keeps at most MAX_TOOLS tools
 * and MAX_TOOL_LIST_BYTES bytes, with the allowlisted tools first, so the
 * caps drop other tools before them. a8 skips a tool that doesn't fit.
 */
export function storedToolList(connector: Connector, tools: McpTool[]): string {
  const allowlisted = new Set(connector.toolAllowlist.map((tool) => tool.name));
  const ordered = [
    ...tools.filter((tool) => allowlisted.has(tool.name)),
    ...tools.filter((tool) => !allowlisted.has(tool.name)),
  ];
  const encoder = new TextEncoder();
  const kept: string[] = [];
  // The list starts with the two bytes of its brackets.
  let bytes = 2;
  for (const tool of ordered) {
    if (kept.length === MAX_TOOLS) break;
    const json = JSON.stringify(storedTool(tool));
    // Every tool but the first adds a comma.
    const size = encoder.encode(json).length + (kept.length > 0 ? 1 : 0);
    if (bytes + size > MAX_TOOL_LIST_BYTES) continue;
    kept.push(json);
    bytes += size;
  }
  if (kept.length < tools.length) {
    console.warn(
      `Stored ${kept.length} of ${connector.name}'s ${tools.length} tools, ${bytes} bytes.`,
    );
  }
  return `[${kept.join(",")}]`;
}

function storedTool(tool: McpTool): McpTool {
  return {
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
