/**
 * How a8 gets an OAuth client for a connector's MCP server. With dynamic
 * registration, a8 registers itself once per deployment. A pre-registered
 * client's ID and secret come from the env vars named here.
 */
export type ConnectorSignIn =
  | { kind: "dynamicRegistration" }
  | { kind: "preRegistered"; clientIdEnvVar: string; clientSecretEnvVar: string };

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
  toolAllowlist: string[];
  /** Tools that ask for approval even when the server marks them read-only. */
  toolsNeedingApproval: string[];
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
    // Empty until replies use Notion's tools.
    toolAllowlist: [],
    toolsNeedingApproval: [],
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
