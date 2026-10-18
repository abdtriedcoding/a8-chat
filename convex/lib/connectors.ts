// The server's side of the catalog: how a8 reaches each connector's MCP
// servers and how it signs in. The UI never imports this module. Ids, card
// fields, server keys and tools (label, kind and target) live in
// connectorView.ts, and the maps here are keyed by its ids and server keys.

import { v } from "convex/values";
import { env } from "../_generated/server";
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
export type ConnectorTool = ConnectorToolView & {
  /**
   * The scope the tool needs. A connection whose granted scopes lack it
   * doesn't offer the tool. Undefined means any connection offers it.
   */
  scope?: string;
};

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
 * How a user's connection to a connector gets its access:
 * - `dynamicRegistration`: the user signs in at the vendor's consent
 *   screen, through an OAuth client a8 registers with the vendor once per
 *   deployment.
 * - `none`: the MCP server answers without a token. Turning the connector
 *   on lists its tools without one and stores a connection with no tokens.
 * - `preRegistered`: the user signs in at the vendor's consent screen,
 *   through an OAuth client the deployer registered with the vendor, for a
 *   vendor with no dynamic registration, like Google. `credentials` reads
 *   its ID and secret from the deployment's env vars, and the connector
 *   shows as not set up while either is missing. `tokenEndpoint` is where token
 *   refresh goes, since a8 stores no registration for this client.
 */
export type SignIn =
  | { kind: "dynamicRegistration" }
  | { kind: "none" }
  | {
      kind: "preRegistered";
      credentials: () => { clientId?: string; clientSecret?: string };
      tokenEndpoint: string;
    };

/** How a8 signs in to a connector and what it may contact. */
type ConnectorAccess<Tool extends string> = {
  /** Dynamic registration when left out. */
  signIn?: SignIn;
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
  /**
   * The scope each tool needs, for a vendor whose consent screen lets the
   * user untick scopes, like Google's. A tool left out needs none.
   */
  toolScopes?: { [Name in Tool]?: string };
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

const GOOGLE_CALENDAR_EVENTS = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_CALENDAR_LIST =
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_COMPOSE = "https://www.googleapis.com/auth/gmail.compose";

/**
 * What every Google connector shares, since one OAuth client from the
 * deployment's own Google Cloud project serves them all (ADR 0007).
 */
const GOOGLE_ACCESS = {
  signIn: {
    kind: "preRegistered",
    credentials: () => ({
      clientId: env.GOOGLE_MCP_CLIENT_ID,
      clientSecret: env.GOOGLE_MCP_CLIENT_SECRET,
    }),
    tokenEndpoint: "https://oauth2.googleapis.com/token",
  },
  // Google gives a refresh token only with both (ADR 0007).
  authorizeParams: { access_type: "offline", prompt: "consent" },
} satisfies Pick<ConnectorAccess<string>, "signIn" | "authorizeParams">;
const GOOGLE_AUTH_ORIGINS = [
  "https://accounts.google.com",
  "https://oauth2.googleapis.com",
];

const GOOGLE_DRIVE_READONLY = "https://www.googleapis.com/auth/drive.readonly";
const GOOGLE_DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_DOCS = "https://www.googleapis.com/auth/documents";
const GOOGLE_SHEETS = "https://www.googleapis.com/auth/spreadsheets";
const GOOGLE_SLIDES = "https://www.googleapis.com/auth/presentations";

/**
 * The account label of a connector on Google's Drive server. No Drive tool
 * says who the account is, but each file names its owner's email. A user
 * who owns no files gets no label.
 */
const DRIVE_FILE_OWNER = {
  from: "tool",
  tool: "search_files",
  arguments: {
    query: "owner = 'me'",
    pageSize: 1,
    excludeContentSnippets: true,
  },
  field: "files.0.owner",
} as const;

const ENTRIES: { [Id in ConnectorId]: ConnectorEntry<Id> } = {
  notion: {
    servers: {
      notion: {
        url: "https://mcp.notion.com/mcp",
      },
    },
    pinnedOrigins: ["https://mcp.notion.com"],
    // Notion's MCP client guide asks for the consent screen on every sign-in.
    authorizeParams: { prompt: "consent" },
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
  excalidraw: {
    servers: {
      excalidraw: {
        url: "https://mcp.excalidraw.com/mcp",
      },
    },
    pinnedOrigins: ["https://mcp.excalidraw.com"],
    signIn: { kind: "none" },
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
  googlecalendar: {
    servers: {
      googlecalendar: {
        url: "https://calendarmcp.googleapis.com/mcp/v1",
      },
    },
    ...GOOGLE_ACCESS,
    pinnedOrigins: ["https://calendarmcp.googleapis.com", ...GOOGLE_AUTH_ORIGINS],
    scopes: [GOOGLE_CALENDAR_EVENTS, GOOGLE_CALENDAR_LIST],
    toolScopes: {
      list_calendars: GOOGLE_CALENDAR_LIST,
      list_events: GOOGLE_CALENDAR_EVENTS,
      search_events: GOOGLE_CALENDAR_EVENTS,
      get_event: GOOGLE_CALENDAR_EVENTS,
      suggest_time: GOOGLE_CALENDAR_EVENTS,
      create_event: GOOGLE_CALENDAR_EVENTS,
      update_event: GOOGLE_CALENDAR_EVENTS,
      delete_event: GOOGLE_CALENDAR_EVENTS,
      respond_to_event: GOOGLE_CALENDAR_EVENTS,
    },
    // The primary calendar's title is the account's email address.
    accountLabel: {
      from: "tool",
      tool: "list_events",
      arguments: { calendarId: "primary", pageSize: 1 },
      field: "summary",
    },
  },
  gmail: {
    servers: {
      gmail: {
        url: "https://gmailmcp.googleapis.com/mcp/v1",
      },
    },
    ...GOOGLE_ACCESS,
    pinnedOrigins: ["https://gmailmcp.googleapis.com", ...GOOGLE_AUTH_ORIGINS],
    scopes: [GMAIL_READONLY, GMAIL_COMPOSE],
    toolScopes: {
      search_threads: GMAIL_READONLY,
      get_thread: GMAIL_READONLY,
      get_message: GMAIL_READONLY,
      list_drafts: GMAIL_READONLY,
      get_draft: GMAIL_READONLY,
      list_labels: GMAIL_READONLY,
      create_draft: GMAIL_COMPOSE,
    },
    // No Gmail tool returns the account's address, but every draft's sender
    // is the account. A sent thread's first message can be someone else's.
    // Until the account has a draft there's no label, and each tool list
    // refresh tries again.
    accountLabel: {
      from: "tool",
      tool: "list_drafts",
      arguments: { pageSize: 1, view: "DRAFT_VIEW_METADATA_ONLY" },
      field: "drafts.0.sender",
    },
  },
  googledrive: {
    servers: {
      drive: { url: "https://drivemcp.googleapis.com/mcp/v1" },
      docs: { url: "https://docsmcp.googleapis.com/mcp/v1" },
      sheets: { url: "https://sheetsmcp.googleapis.com/mcp/v1" },
      slides: { url: "https://slidesmcp.googleapis.com/mcp/v1" },
    },
    ...GOOGLE_ACCESS,
    pinnedOrigins: [
      "https://drivemcp.googleapis.com",
      "https://docsmcp.googleapis.com",
      "https://sheetsmcp.googleapis.com",
      "https://slidesmcp.googleapis.com",
      ...GOOGLE_AUTH_ORIGINS,
    ],
    scopes: [
      GOOGLE_DRIVE_READONLY,
      GOOGLE_DRIVE_FILE,
      GOOGLE_DOCS,
      GOOGLE_SHEETS,
      GOOGLE_SLIDES,
    ],
    // All four servers take drive.readonly for reads, so a user who unticks
    // an editing scope keeps every read.
    toolScopes: {
      search_files: GOOGLE_DRIVE_READONLY,
      list_recent_files: GOOGLE_DRIVE_READONLY,
      read_file_content: GOOGLE_DRIVE_READONLY,
      create_file: GOOGLE_DRIVE_FILE,
      read_doc: GOOGLE_DRIVE_READONLY,
      update_doc: GOOGLE_DOCS,
      get_spreadsheet: GOOGLE_DRIVE_READONLY,
      get_values: GOOGLE_DRIVE_READONLY,
      update_values: GOOGLE_SHEETS,
      update_spreadsheet: GOOGLE_SHEETS,
      read_presentation: GOOGLE_DRIVE_READONLY,
      update_presentation: GOOGLE_SLIDES,
    },
    accountLabel: DRIVE_FILE_OWNER,
  },
  googledocs: {
    servers: {
      drive: { url: "https://drivemcp.googleapis.com/mcp/v1" },
      docs: { url: "https://docsmcp.googleapis.com/mcp/v1" },
    },
    ...GOOGLE_ACCESS,
    pinnedOrigins: [
      "https://drivemcp.googleapis.com",
      "https://docsmcp.googleapis.com",
      ...GOOGLE_AUTH_ORIGINS,
    ],
    scopes: [GOOGLE_DRIVE_READONLY, GOOGLE_DRIVE_FILE, GOOGLE_DOCS],
    // As in Google Drive, every read needs only drive.readonly.
    toolScopes: {
      search_files: GOOGLE_DRIVE_READONLY,
      list_recent_files: GOOGLE_DRIVE_READONLY,
      create_file: GOOGLE_DRIVE_FILE,
      copy_file: GOOGLE_DRIVE_FILE,
      read_doc: GOOGLE_DRIVE_READONLY,
      update_doc: GOOGLE_DOCS,
    },
    accountLabel: DRIVE_FILE_OWNER,
  },
  googlesheets: {
    servers: {
      drive: { url: "https://drivemcp.googleapis.com/mcp/v1" },
      sheets: { url: "https://sheetsmcp.googleapis.com/mcp/v1" },
    },
    ...GOOGLE_ACCESS,
    pinnedOrigins: [
      "https://drivemcp.googleapis.com",
      "https://sheetsmcp.googleapis.com",
      ...GOOGLE_AUTH_ORIGINS,
    ],
    scopes: [GOOGLE_DRIVE_READONLY, GOOGLE_DRIVE_FILE, GOOGLE_SHEETS],
    // As in Google Drive, every read needs only drive.readonly.
    toolScopes: {
      search_files: GOOGLE_DRIVE_READONLY,
      list_recent_files: GOOGLE_DRIVE_READONLY,
      create_file: GOOGLE_DRIVE_FILE,
      copy_file: GOOGLE_DRIVE_FILE,
      get_spreadsheet: GOOGLE_DRIVE_READONLY,
      get_values: GOOGLE_DRIVE_READONLY,
      update_values: GOOGLE_SHEETS,
      update_formulas: GOOGLE_SHEETS,
      insert_dimension: GOOGLE_SHEETS,
      update_spreadsheet: GOOGLE_SHEETS,
    },
    accountLabel: DRIVE_FILE_OWNER,
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
    const toolScopes: Record<string, string | undefined> =
      access.toolScopes ?? {};
    return {
      ...view,
      ...access,
      servers: Object.entries(serverViews).map(
        ([key, { toolPrefix, tools }]) => ({
          key,
          url: urls[key].url,
          toolPrefix,
          tools: new Map(
            Object.entries(tools).map(([name, tool]) => [
              name,
              { ...tool, scope: toolScopes[name] },
            ]),
          ),
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

/** Whether turning the connector on sends the user to the vendor's sign-in. */
export function needsSignIn(connector: Connector): boolean {
  return connector.signIn?.kind !== "none";
}

/**
 * Whether the deployment has what the connector's sign-in needs. Only a
 * pre-registered client can be missing, when its env vars aren't set.
 */
export function isSetUp(connector: Connector): boolean {
  return (
    connector.signIn?.kind !== "preRegistered" ||
    preRegisteredCredentials(connector) !== undefined
  );
}

/**
 * A pre-registered client's ID and secret from the env vars. Undefined for
 * any other sign-in, or while either env var is missing.
 */
export function preRegisteredCredentials(
  connector: Connector,
): { clientId: string; clientSecret: string } | undefined {
  if (connector.signIn?.kind !== "preRegistered") return undefined;
  const { clientId, clientSecret } = connector.signIn.credentials();
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

/**
 * Whether the connection lacks a scope sign-in asked for, because the user
 * unticked it on the vendor's consent screen. Some of the connector's
 * tools then don't load (offeredTools in connectorTools.ts).
 */
export function missesScopes(
  connector: Connector,
  grantedScopes: string[] | undefined,
): boolean {
  if (!grantedScopes) return false;
  return (connector.scopes ?? []).some(
    (scope) => !grantedScopes.includes(scope),
  );
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
