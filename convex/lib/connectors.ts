/**
 * How a8 gets an OAuth client for a connector's MCP server. With dynamic
 * registration, a8 registers itself once per deployment. A pre-registered
 * client's ID and secret come from the env vars named here.
 */
export type ConnectorSignIn =
  | { kind: "dynamicRegistration" }
  | { kind: "preRegistered"; clientIdEnvVar: string; clientSecretEnvVar: string };

/** One tool a8 offers the model from a connector's MCP server. */
export type ConnectorTool = {
  /** The tool's name on the MCP server, like `notion-search`. */
  name: string;
  /**
   * Whether a8 counts the tool as a read or an action. A read runs without
   * asking, unless the server marks the tool not read-only. An action always
   * waits on an action card (ADR 0008).
   */
  kind: "read" | "action";
  /** What the tool's row in a reply says, like "Searching Notion". */
  label: string;
};

/**
 * Where the account label on a connected card comes from:
 * - `tokenResponse`: a field of the vendor's token response, like Notion's
 *   `workspace_name`.
 * - `tool`: a read tool a8 calls once after sign-in, like a "who am I" tool.
 *   `field` is a dot path into its result, like `organization.name`. a8
 *   reads the result's structured content, or else its first text part as
 *   JSON.
 */
export type AccountLabelSource =
  | { from: "tokenResponse"; field: string }
  | {
      from: "tool";
      tool: string;
      arguments?: Record<string, unknown>;
      field: string;
    };

/** One entry in a8's catalog: an app a8 can work with through MCP. */
export type Connector = {
  /**
   * Lowercase letters and digits. It starts the model's name for each of
   * the connector's tools, so changing it makes old threads lose their
   * tool rows.
   */
  id: string;
  name: string;
  /** Typed after @ to mention the connector, like `notion`. */
  handle: string;
  /** Path of the logo under public/. */
  logo: string;
  description: string;
  /** Shown on the card. Clicking it starts a new chat with this prompt. */
  examplePrompt: string;
  mcpServerUrl: string;
  /**
   * Every origin a8 talks to for this connector: the MCP server's, and each
   * one its sign-in uses, like a separate authorization server or token
   * host. a8 refuses any other origin, and refuses an authorization server
   * whose origin isn't listed here (ADR 0003).
   */
  pinnedOrigins: string[];
  signIn: ConnectorSignIn;
  /** The MCP tools a8 offers the model. Every other tool stays hidden. */
  toolAllowlist: ConnectorTool[];
  /**
   * Where the name of the signed-in account comes from. A label tool must
   * be a `read` on the allowlist, because a8 calls it without asking. The card shows it
   * once connected, and shows nothing when the source gives no label.
   */
  accountLabel?: AccountLabelSource;
};

/** Every connector a8 ships with. */
export const CONNECTORS: Connector[] = [
  {
    id: "notion",
    name: "Notion",
    handle: "notion",
    logo: "/connectors/notion.svg",
    description: "Search, read and write pages in your Notion workspace.",
    examplePrompt:
      "@notion find my notes from this week and list the action items",
    mcpServerUrl: "https://mcp.notion.com/mcp",
    pinnedOrigins: ["https://mcp.notion.com"],
    signIn: { kind: "dynamicRegistration" },
    toolAllowlist: [
      { name: "notion-search", kind: "read", label: "Searching Notion" },
      { name: "notion-fetch", kind: "read", label: "Reading Notion" },
      { name: "notion-query-data-sources", kind: "read", label: "Reading a Notion database" },
      { name: "notion-get-comments", kind: "read", label: "Reading Notion comments" },
      { name: "notion-get-users", kind: "read", label: "Finding Notion users" },
      { name: "notion-get-teams", kind: "read", label: "Finding Notion teamspaces" },
      { name: "notion-create-pages", kind: "action", label: "Creating Notion pages" },
      { name: "notion-update-page", kind: "action", label: "Updating a Notion page" },
      { name: "notion-move-pages", kind: "action", label: "Moving Notion pages" },
      { name: "notion-duplicate-page", kind: "action", label: "Duplicating a Notion page" },
      { name: "notion-create-database", kind: "action", label: "Creating a Notion database" },
      { name: "notion-create-comment", kind: "action", label: "Commenting in Notion" },
    ],
    accountLabel: { from: "tokenResponse", field: "workspace_name" },
  },
  {
    id: "linear",
    name: "Linear",
    handle: "linear",
    logo: "/connectors/linear.svg",
    description: "Find, create and update Linear issues, and comment on them.",
    examplePrompt: "@linear list my open issues, highest priority first",
    mcpServerUrl: "https://mcp.linear.app/mcp",
    pinnedOrigins: ["https://mcp.linear.app"],
    signIn: { kind: "dynamicRegistration" },
    toolAllowlist: [
      { name: "list_issues", kind: "read", label: "Searching Linear issues" },
      { name: "get_issue", kind: "read", label: "Reading a Linear issue" },
      { name: "list_comments", kind: "read", label: "Reading Linear comments" },
      { name: "list_projects", kind: "read", label: "Finding Linear projects" },
      { name: "list_teams", kind: "read", label: "Finding Linear teams" },
      { name: "list_users", kind: "read", label: "Finding Linear users" },
      { name: "list_issue_statuses", kind: "read", label: "Finding Linear statuses" },
      { name: "list_issue_labels", kind: "read", label: "Finding Linear labels" },
      { name: "get_workspace", kind: "read", label: "Reading the Linear workspace" },
      { name: "save_issue", kind: "action", label: "Saving a Linear issue" },
      { name: "save_comment", kind: "action", label: "Commenting in Linear" },
    ],
    accountLabel: { from: "tool", tool: "get_workspace", field: "name" },
  },
  {
    id: "todoist",
    name: "Todoist",
    handle: "todoist",
    logo: "/connectors/todoist.svg",
    description: "Find, add and complete Todoist tasks.",
    examplePrompt: "@todoist what's due today?",
    mcpServerUrl: "https://ai.todoist.net/mcp",
    pinnedOrigins: ["https://ai.todoist.net", "https://todoist.com"],
    signIn: { kind: "dynamicRegistration" },
    toolAllowlist: [
      { name: "find-tasks", kind: "read", label: "Searching Todoist tasks" },
      { name: "find-tasks-by-date", kind: "read", label: "Finding Todoist tasks by date" },
      { name: "find-completed-tasks", kind: "read", label: "Finding completed Todoist tasks" },
      { name: "find-projects", kind: "read", label: "Finding Todoist projects" },
      { name: "find-sections", kind: "read", label: "Finding Todoist sections" },
      { name: "find-labels", kind: "read", label: "Finding Todoist labels" },
      { name: "find-comments", kind: "read", label: "Reading Todoist comments" },
      { name: "get-overview", kind: "read", label: "Reading a Todoist project overview" },
      { name: "user-info", kind: "read", label: "Reading the Todoist account" },
      { name: "add-tasks", kind: "action", label: "Adding Todoist tasks" },
      { name: "complete-tasks", kind: "action", label: "Completing Todoist tasks" },
    ],
    accountLabel: { from: "tool", tool: "user-info", field: "email" },
  },
];

/**
 * Why a sign-in ended without connecting: the user cancelled at the vendor,
 * the sign-in expired or belongs to another user, or a step failed.
 */
export const CONNECT_ERRORS = ["cancelled", "expired", "failed"] as const;
export type ConnectError = (typeof CONNECT_ERRORS)[number];

export function findConnector(id: string): Connector | undefined {
  return CONNECTORS.find((connector) => connector.id === id);
}

/**
 * The tool error a connector's tool returns once its connection needs
 * reconnecting. The reply shows a Reconnect chip for a call that failed
 * with it, so the text has to stay exactly this.
 */
export function needsReconnectError(connector: Connector): string {
  return `${connector.name} needs reconnecting. Tell the user to reconnect ${connector.name}, and answer without it.`;
}

/**
 * What can come right before the @ of a mention: the start of the text,
 * whitespace, an opening bracket or a quote. So `(@notion` is a mention,
 * and an email address like `me@notion.so` isn't.
 */
export const MENTION_START = String.raw`(?<=^|[\s(\["'])`;

/**
 * The connectors a prompt mentions, in catalog order. A mention is @ and a
 * handle after MENTION_START, not followed by a letter, digit, - or _. Case
 * doesn't matter, so `@Notion` counts.
 */
export function findMentions(text: string): Connector[] {
  const handles = new Set(
    Array.from(
      text.matchAll(new RegExp(String.raw`${MENTION_START}@([\w-]+)`, "g")),
      (match) => match[1].toLowerCase(),
    ),
  );
  return CONNECTORS.filter((connector) => handles.has(connector.handle));
}

/** The longest tool name Anthropic accepts. */
const MAX_TOOL_NAME_LENGTH = 64;

/**
 * The model's name for a connector's tool, `<connector id>__<tool>`. A
 * prefix of the connector's ID that the vendor puts on its own names is
 * dropped, so `notion-search` becomes `notion__search`. Characters outside
 * `[a-zA-Z0-9_-]` become `_`, and a name over 64 characters is cut short.
 * Either way the name then ends in a hash of the vendor's name, so `a.b`
 * and `a_b` still get different names.
 */
export function modelToolName(connector: Connector, mcpName: string): string {
  const tool =
    mcpName.startsWith(connector.id) &&
    ["-", "_", "."].includes(mcpName.charAt(connector.id.length))
      ? mcpName.slice(connector.id.length + 1)
      : mcpName;
  const full = `${connector.id}__${tool}`;
  const name = full.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (name === full && name.length <= MAX_TOOL_NAME_LENGTH) return name;
  const hash = fnv1a(`${connector.id}__${mcpName}`);
  const kept = Math.min(name.length, MAX_TOOL_NAME_LENGTH - hash.length - 1);
  return `${name.slice(0, kept)}_${hash}`;
}

/** The 32-bit FNV-1a hash of the text, as 8 hex digits. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash = Math.imul(hash ^ byte, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Every allowlisted tool by its model name. */
const TOOLS_BY_MODEL_NAME = new Map(
  CONNECTORS.flatMap((connector) =>
    connector.toolAllowlist.map(
      (tool) => [modelToolName(connector, tool.name), { connector, tool }] as const,
    ),
  ),
);

/**
 * The connector and allowlist entry behind a model tool name, and the label
 * its row shows. Undefined for a8's own tools, like webSearch. A tool since
 * dropped from the allowlist has no entry and gets a generic label, so old
 * threads still show it.
 */
export function findConnectorTool(
  modelName: string,
): { connector: Connector; tool?: ConnectorTool; label: string } | undefined {
  const found = TOOLS_BY_MODEL_NAME.get(modelName);
  if (found) return { ...found, label: found.tool.label };
  const connector = CONNECTORS.find((entry) =>
    modelName.startsWith(`${entry.id}__`),
  );
  return connector && { connector, label: `Using ${connector.name}` };
}
