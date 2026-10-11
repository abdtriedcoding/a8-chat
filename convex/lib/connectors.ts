// The server's side of the catalog: how a8 reaches each connector's MCP
// servers, how it signs in, and whether each tool is a read or an action.
// The UI never imports this module. Ids, card fields, server keys and tool
// labels live in connectorView.ts, and the maps here are keyed by its ids,
// server keys and tool names.

import { v } from "convex/values";
import {
  CONNECTOR_VIEWS,
  RECONNECT_ERROR_CODE,
  type ConnectorId,
  type ConnectorToolName,
  type ConnectorServerView,
  type ConnectorToolView,
  type ConnectorView,
  type ServerKey,
  type ServerToolName,
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

/** One tool a8 offers the model from an MCP server. */
export type ConnectorTool = ConnectorToolView & { kind: ToolKind };

/** One of a connector's MCP servers. */
export type ConnectorServer = {
  /**
   * Names the server within its connector, like `notion`. Stored tool lists
   * name each tool's server by it.
   */
  key: string;
  url: string;
  /** See ConnectorServerView. */
  toolPrefix?: string;
  /**
   * The tools a8 offers from this server, by their name on the server.
   * Every other tool stays hidden. Undefined means the server has no
   * allowlist, like a custom connector's (#124). a8 then stores and offers
   * every tool the server lists, up to the tool list caps, with a generic
   * label, and each one waits on an action card.
   */
  tools?: ReadonlyMap<string, ConnectorTool>;
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

/** How a8 signs in to a connector and what it may contact. */
type ConnectorAccess<Tool extends string> = {
  /**
   * Every origin a8 talks to for this connector: each MCP server's, and
   * each one its sign-in uses, like a separate authorization server or
   * token host. a8 refuses any other origin, and refuses an authorization
   * server whose origin isn't listed here (ADR 0003).
   */
  pinnedOrigins: string[];
  signIn: ConnectorSignIn;
  /**
   * The scopes sign-in asks for. Without them, a8 asks for the scopes the
   * first server's protected resource metadata lists, if it lists any.
   */
  scopes?: string[];
  /**
   * Extra query parameters on the vendor's authorize URL, like Google's
   * `access_type: "offline"`. Never one auth() sets itself, like `scope`,
   * `state` or `redirect_uri`.
   */
  authorizeParams?: Record<string, string>;
  /**
   * Where the name of the signed-in account comes from. A label tool must
   * be a `read`, because a8 calls it without asking. The card shows it once
   * connected, and shows nothing when the source gives no label.
   */
  accountLabel?: AccountLabelSource<Tool>;
};

/** The server fields of one catalog connector, as written below. */
type ConnectorEntry<Id extends ConnectorId> = ConnectorAccess<
  ConnectorToolName<Id>
> & {
  /**
   * Each MCP server connectorView.ts lists for the connector, by its key,
   * with its URL and the kind of each of its tools. Sign-in reads the
   * OAuth metadata of the first server here, and the token it gets must
   * work on every server.
   */
  servers: {
    [Key in ServerKey<Id>]: {
      url: string;
      toolKinds: Record<ServerToolName<Id, Key>, ToolKind>;
    };
  };
};

/**
 * An app a8 works with through MCP: a catalog entry, or a custom connector
 * a user adds (#124), whose id isn't a ConnectorId.
 */
export type Connector = Omit<ConnectorView, "id" | "servers"> &
  ConnectorAccess<string> & {
    id: string;
    /** At least one. Sign-in reads the first one's OAuth metadata. */
    servers: ConnectorServer[];
  };

/** A connector from a8's catalog. */
export type CatalogConnector = Connector & { id: ConnectorId };

const ENTRIES: { [Id in ConnectorId]: ConnectorEntry<Id> } = {
  notion: {
    servers: {
      notion: {
        url: "https://mcp.notion.com/mcp",
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
      },
    },
    pinnedOrigins: ["https://mcp.notion.com"],
    signIn: { kind: "dynamicRegistration" },
    accountLabel: { from: "tokenResponse", field: "workspace_name" },
  },
  linear: {
    servers: {
      linear: {
        url: "https://mcp.linear.app/mcp",
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
      },
    },
    pinnedOrigins: ["https://mcp.linear.app"],
    signIn: { kind: "dynamicRegistration" },
    accountLabel: { from: "tool", tool: "get_workspace", field: "name" },
  },
  todoist: {
    servers: {
      todoist: {
        url: "https://ai.todoist.net/mcp",
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
      },
    },
    pinnedOrigins: ["https://ai.todoist.net", "https://todoist.com"],
    signIn: { kind: "dynamicRegistration" },
    accountLabel: { from: "tool", tool: "user-info", field: "email" },
  },
  airtable: {
    servers: {
      airtable: {
        url: "https://mcp.airtable.com/mcp",
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
    },
    pinnedOrigins: ["https://mcp.airtable.com", "https://airtable.com"],
    signIn: { kind: "dynamicRegistration" },
  },
  calendly: {
    servers: {
      calendly: {
        url: "https://mcp.calendly.com",
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
      },
    },
    pinnedOrigins: ["https://mcp.calendly.com", "https://calendly.com"],
    signIn: { kind: "dynamicRegistration" },
    accountLabel: { from: "tool", tool: "users-get_current_user", field: "resource.email" },
  },
};

/**
 * Every connector a8 ships with, in catalog order. Each one's servers keep
 * their order in ENTRIES, so the first there signs in.
 */
export const CONNECTORS: CatalogConnector[] = CONNECTOR_VIEWS.map(
  ({ servers: serverViews, ...view }) => {
    const { servers, ...access } = ENTRIES[view.id];
    const views: Record<string, ConnectorServerView> = serverViews;
    const entries: [string, ServerEntry][] = Object.entries(servers);
    return {
      ...view,
      ...access,
      servers: entries.map(([key, { url, toolKinds }]) => {
        const { toolPrefix, tools } = views[key];
        return {
          key,
          url,
          toolPrefix,
          tools: new Map(
            Object.entries(tools).map(([name, tool]) => [
              name,
              { ...tool, kind: toolKinds[name] },
            ]),
          ),
        };
      }),
    };
  },
);

/** One server of a catalog entry, with its tool names as plain strings. */
type ServerEntry = { url: string; toolKinds: Record<string, ToolKind> };

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
export function findConnector(id: ConnectorId): CatalogConnector;
export function findConnector<Id extends string>(
  id: Id & (string extends Id ? unknown : never),
): CatalogConnector | undefined;
export function findConnector(id: string): CatalogConnector | undefined {
  return CONNECTORS_BY_ID.get(id as ConnectorId);
}

/**
 * The server sign-in reads OAuth metadata from, the connector's first.
 * Sign-in, token refresh and revocation run against its URL.
 */
export function signInServer(connector: Connector): ConnectorServer {
  return connector.servers[0];
}

/**
 * The allowlisted tool with this name on any of the connector's servers,
 * and its server. Undefined if no server lists it.
 */
export function findAllowlistedTool(
  connector: Connector,
  name: string,
): { server: ConnectorServer; tool: ConnectorTool } | undefined {
  for (const server of connector.servers) {
    const tool = server.tools?.get(name);
    if (tool) return { server, tool };
  }
  return undefined;
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
