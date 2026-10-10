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

/** One entry in a8's catalog: an app a8 can work with through MCP. */
export type Connector = {
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
   * The only origins a8 talks to for this connector. Any other MCP server
   * or authorization server origin is refused (ADR 0003).
   */
  pinnedOrigins: { mcpServer: string; authorizationServer: string };
  signIn: ConnectorSignIn;
  /** The MCP tools a8 offers the model. Every other tool stays hidden. */
  toolAllowlist: ConnectorTool[];
  /**
   * The field of the vendor's token response that names the signed-in
   * account, like Notion's `workspace_name`. The card shows it once connected.
   */
  accountLabelField?: string;
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
    pinnedOrigins: {
      mcpServer: "https://mcp.notion.com",
      authorizationServer: "https://mcp.notion.com",
    },
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
    accountLabelField: "workspace_name",
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

/**
 * The model's name for a connector's tool, `<handle>__<tool>`. The handle
 * prefix Notion puts on its own names is dropped, so `notion-search`
 * becomes `notion__search`.
 */
export function modelToolName(connector: Connector, mcpName: string): string {
  const prefix = `${connector.handle}-`;
  const tool = mcpName.startsWith(prefix) ? mcpName.slice(prefix.length) : mcpName;
  return `${connector.handle}__${tool}`;
}

/**
 * The connector behind a model tool name, and the label its row shows.
 * Undefined for a8's own tools, like webSearch. A tool since dropped from
 * the allowlist gets a generic label, so old threads still show it.
 */
export function findConnectorTool(
  modelName: string,
): { connector: Connector; label: string } | undefined {
  const separator = modelName.indexOf("__");
  if (separator === -1) return undefined;
  const handle = modelName.slice(0, separator);
  const connector = CONNECTORS.find((entry) => entry.handle === handle);
  if (!connector) return undefined;
  const tool = connector.toolAllowlist.find(
    (entry) => modelToolName(connector, entry.name) === modelName,
  );
  return { connector, label: tool?.label ?? `Using ${connector.name}` };
}
