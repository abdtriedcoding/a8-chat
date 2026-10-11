// The server's side of the catalog: how a8 reaches each connector's MCP
// server, how it signs in, and whether each tool is a read or an action.
// The UI never imports this module. Ids, card fields and tool labels live
// in connectorView.ts, and the maps here are keyed by its ids and tool
// names.

import { v } from "convex/values";
import {
  CONNECTOR_VIEWS,
  RECONNECT_ERROR_CODE,
  type ConnectorId,
  type ConnectorToolName,
  type ConnectorView,
} from "./connectorView";

/**
 * How a8 gets an OAuth client for a connector's MCP server. With dynamic
 * registration, a8 registers itself once per deployment.
 */
export type ConnectorSignIn = { kind: "dynamicRegistration" };

/**
 * Whether a8 counts a tool as a read or an action. A read runs without
 * asking, unless the server marks the tool not read-only. An action always
 * waits on an action card (ADR 0008).
 */
export type ToolKind = "read" | "action";

/** One tool a8 offers the model from a connector's MCP server. */
export type ConnectorTool = {
  /** The tool's name on the MCP server, like `notion-search`. */
  name: string;
  kind: ToolKind;
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
export type AccountLabelSource<Tool extends string = string> =
  | { from: "tokenResponse"; field: string }
  | {
      from: "tool";
      tool: Tool;
      arguments?: Record<string, unknown>;
      field: string;
    };

/** The server fields of one catalog connector, as written below. */
type ConnectorServer<Id extends ConnectorId> = {
  mcpServerUrl: string;
  /**
   * Every origin a8 talks to for this connector: the MCP server's, and each
   * one its sign-in uses, like a separate authorization server or token
   * host. a8 refuses any other origin, and refuses an authorization server
   * whose origin isn't listed here (ADR 0003).
   */
  pinnedOrigins: string[];
  signIn: ConnectorSignIn;
  /** The kind of each tool connectorView.ts lists for the connector. */
  toolKinds: Record<ConnectorToolName<Id>, ToolKind>;
  /**
   * Where the name of the signed-in account comes from. A label tool must
   * be a `read`, because a8 calls it without asking. The card shows it once
   * connected, and shows nothing when the source gives no label.
   */
  accountLabel?: AccountLabelSource<ConnectorToolName<Id>>;
};

/** One entry in a8's catalog: an app a8 can work with through MCP. */
export type Connector = Omit<ConnectorView, "tools"> &
  Omit<ConnectorServer<ConnectorId>, "toolKinds" | "accountLabel"> & {
    /** The MCP tools a8 offers the model. Every other tool stays hidden. */
    toolAllowlist: ConnectorTool[];
    accountLabel?: AccountLabelSource;
  };

const SERVERS: { [Id in ConnectorId]: ConnectorServer<Id> } = {
  notion: {
    mcpServerUrl: "https://mcp.notion.com/mcp",
    pinnedOrigins: ["https://mcp.notion.com"],
    signIn: { kind: "dynamicRegistration" },
    toolKinds: {
      "notion-search": "read",
      "notion-fetch": "read",
      "notion-query-data-sources": "read",
      "notion-get-comments": "read",
      "notion-get-users": "read",
      "notion-get-teams": "read",
      "notion-create-pages": "action",
      "notion-update-page": "action",
      "notion-move-pages": "action",
      "notion-duplicate-page": "action",
      "notion-create-database": "action",
      "notion-create-comment": "action",
    },
    accountLabel: { from: "tokenResponse", field: "workspace_name" },
  },
  linear: {
    mcpServerUrl: "https://mcp.linear.app/mcp",
    pinnedOrigins: ["https://mcp.linear.app"],
    signIn: { kind: "dynamicRegistration" },
    toolKinds: {
      list_issues: "read",
      get_issue: "read",
      list_comments: "read",
      list_projects: "read",
      list_teams: "read",
      list_users: "read",
      list_issue_statuses: "read",
      list_issue_labels: "read",
      get_workspace: "read",
      save_issue: "action",
      save_comment: "action",
    },
    accountLabel: { from: "tool", tool: "get_workspace", field: "name" },
  },
  todoist: {
    mcpServerUrl: "https://ai.todoist.net/mcp",
    pinnedOrigins: ["https://ai.todoist.net", "https://todoist.com"],
    signIn: { kind: "dynamicRegistration" },
    toolKinds: {
      "find-tasks": "read",
      "find-tasks-by-date": "read",
      "find-completed-tasks": "read",
      "find-projects": "read",
      "find-sections": "read",
      "find-labels": "read",
      "find-comments": "read",
      "get-overview": "read",
      "user-info": "read",
      "add-tasks": "action",
      "complete-tasks": "action",
    },
    accountLabel: { from: "tool", tool: "user-info", field: "email" },
  },
  airtable: {
    mcpServerUrl: "https://mcp.airtable.com/mcp",
    pinnedOrigins: ["https://mcp.airtable.com", "https://airtable.com"],
    signIn: { kind: "dynamicRegistration" },
    toolKinds: {
      list_workspaces: "read",
      list_bases: "read",
      search_bases: "read",
      list_tables_for_base: "read",
      get_table_schema: "read",
      list_records_for_table: "read",
      search_records: "read",
      analyze_table: "read",
      list_record_comments: "read",
      create_records_for_table: "action",
      update_records_for_table: "action",
    },
  },
  calendly: {
    mcpServerUrl: "https://mcp.calendly.com",
    pinnedOrigins: ["https://mcp.calendly.com", "https://calendly.com"],
    signIn: { kind: "dynamicRegistration" },
    toolKinds: {
      "users-get_current_user": "read",
      "event_types-list_event_types": "read",
      "event_types-get_event_type": "read",
      "event_types-list_event_type_available_times": "read",
      "availability-list_user_busy_times": "read",
      "meetings-list_events": "read",
      "meetings-get_event": "read",
      "meetings-list_event_invitees": "read",
      "locations-list_user_meeting_locations": "read",
      "meetings-create_invitee": "action",
      "meetings-cancel_event": "action",
      "scheduling_links-create_single_use_scheduling_link": "action",
    },
    accountLabel: { from: "tool", tool: "users-get_current_user", field: "resource.email" },
  },
};

/** Every connector a8 ships with, in catalog order. */
export const CONNECTORS: Connector[] = CONNECTOR_VIEWS.map(
  ({ tools, ...view }) => {
    const { toolKinds, ...server } = SERVERS[view.id];
    const kinds: Record<string, ToolKind> = toolKinds;
    return {
      ...view,
      ...server,
      toolAllowlist: Object.entries(tools).map(([name, { label }]) => ({
        name,
        kind: kinds[name],
        label,
      })),
    };
  },
);

/** Accepts only a catalog connector's id. Stored ids stay `v.string()`. */
export const vConnectorId = v.union(
  ...CONNECTORS.map((connector) => v.literal(connector.id)),
);

const CONNECTORS_BY_ID = new Map(
  CONNECTORS.map((connector) => [connector.id, connector] as const),
);

/**
 * The catalog connector with this id. A stored id is a plain string and can
 * name a connector since removed, so the result can be undefined. A string
 * literal must be a ConnectorId, so a typo fails the typecheck.
 */
export function findConnector(id: ConnectorId): Connector;
export function findConnector<Id extends string>(
  id: Id & (string extends Id ? unknown : never),
): Connector | undefined;
export function findConnector(id: string): Connector | undefined {
  return CONNECTORS_BY_ID.get(id as ConnectorId);
}

/**
 * What a connector's tool throws once its connection needs reconnecting.
 * The AI SDK turns a tool's error into "<name>: <message>" for the model
 * and the saved reply, so the text starts with RECONNECT_ERROR_CODE and the
 * message is what the model tells the user.
 */
export class ReconnectError extends Error {
  constructor(connector: Connector) {
    super(
      `${connector.name} needs reconnecting. Tell the user to reconnect ${connector.name}, and answer without it.`,
    );
    this.name = RECONNECT_ERROR_CODE;
  }
}
