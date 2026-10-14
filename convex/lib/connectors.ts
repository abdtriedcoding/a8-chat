// The server's side of the catalog: how a8 reaches each connector's MCP
// servers and how it signs in. The UI never imports this module. Ids, card
// fields, server keys and tools (label, kind and target) live in
// connectorView.ts, and the maps here are keyed by its ids and server keys.

import { v } from "convex/values";
import {
  CONNECTOR_VIEWS,
  RECONNECT_ERROR_CODE,
  type ConnectorId,
  type ConnectorToolName,
  type ConnectorToolView,
  type ConnectorView,
  type ServerKey,
} from "./connectorView";

/** One tool a8 offers the model from an MCP server. */
export type ConnectorTool = ConnectorToolView;

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
type AccountLabelSource<Tool extends string = string> =
  | { from: "tokenResponse"; field: string }
  | {
      from: "tool";
      tool: Tool;
      arguments?: Record<string, unknown>;
      field: string;
    };

/**
 * How a8 signs in to a connector and what it may contact. a8 gets an OAuth
 * client by dynamic registration, once per deployment.
 */
type ConnectorAccess<Tool extends string> = {
  /**
   * Every origin a8 talks to for this connector: each MCP server's, and
   * each one its sign-in uses, like a separate authorization server or
   * token host. a8 refuses any other origin, and refuses an authorization
   * server whose origin isn't listed here (ADR 0003).
   */
  pinnedOrigins: string[];
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
   * How a8 authenticates at the vendor's revocation endpoint when its
   * client registration has a secret. `client_secret_basic`, the default,
   * sends HTTP Basic, as the token requests do. `client_secret_post` sends
   * `client_id` and `client_secret` in the form instead, for a vendor whose
   * revocation endpoint refuses Basic, like Atlassian's.
   */
  revocationAuthMethod?: "client_secret_basic" | "client_secret_post";
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
   * with its URL. Sign-in reads the
   * OAuth metadata of the first server here, and the token it gets must
   * work on every server.
   */
  servers: {
    [Key in ServerKey<Id>]: { url: string };
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
type CatalogConnector = Connector & { id: ConnectorId };

const ENTRIES: { [Id in ConnectorId]: ConnectorEntry<Id> } = {
  notion: {
    servers: {
      notion: {
        url: "https://mcp.notion.com/mcp",
      },
    },
    pinnedOrigins: ["https://mcp.notion.com"],
    accountLabel: { from: "tokenResponse", field: "workspace_name" },
  },
  linear: {
    servers: {
      linear: {
        url: "https://mcp.linear.app/mcp",
      },
    },
    pinnedOrigins: ["https://mcp.linear.app"],
    accountLabel: { from: "tool", tool: "get_workspace", field: "name" },
  },
  todoist: {
    servers: {
      todoist: {
        url: "https://ai.todoist.net/mcp",
      },
    },
    pinnedOrigins: ["https://ai.todoist.net", "https://todoist.com"],
    accountLabel: { from: "tool", tool: "user-info", field: "email" },
  },
  airtable: {
    servers: {
      airtable: {
        url: "https://mcp.airtable.com/mcp",
      },
    },
    pinnedOrigins: ["https://mcp.airtable.com", "https://airtable.com"],
  },
  calendly: {
    servers: {
      calendly: {
        url: "https://mcp.calendly.com",
      },
    },
    pinnedOrigins: ["https://mcp.calendly.com", "https://calendly.com"],
    accountLabel: { from: "tool", tool: "users-get_current_user", field: "resource.email" },
  },
  trello: {
    servers: {
      trello: {
        url: "https://mcp.trello.com/v1",
      },
    },
    pinnedOrigins: ["https://mcp.trello.com", "https://auth.atlassian.com"],
    revocationAuthMethod: "client_secret_post",
    // A connection reaches one workspace, so the list has only that one.
    accountLabel: {
      from: "tool",
      tool: "trelloReadWorkspace",
      arguments: { action: "list" },
      field: "workspaces.0.displayName",
    },
  },
};

/**
 * Every connector a8 ships with, in catalog order. Each one's servers keep
 * their order in connectorView.ts, so the first there signs in.
 */
export const CONNECTORS: CatalogConnector[] = CONNECTOR_VIEWS.map(
  ({ servers: serverViews, ...view }) => {
    const { servers, ...access } = ENTRIES[view.id];
    const urls: Record<string, { url: string }> = servers;
    return {
      ...view,
      ...access,
      servers: Object.entries(serverViews).map(
        ([key, { toolPrefix, tools }]) => ({
          key,
          url: urls[key].url,
          toolPrefix,
          tools: new Map(Object.entries(tools)),
        }),
      ),
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
