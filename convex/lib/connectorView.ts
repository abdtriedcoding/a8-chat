// What the browser knows about each catalog connector: its card, its tool
// labels, mention parsing and the error codes the UI reads. The UI imports
// this module and never the server catalog (connectors.ts), so nothing here
// may name an MCP server, a pinned origin, a sign-in or a tool's kind.
//
// Each connector's id, card fields and tool labels live only here. The
// server catalog keys its entries by these ids and its tool kinds by these
// tool names, so a connector or tool missing from either file fails the
// typecheck.

/**
 * One line under a card's description about what the user's own account
 * needs first, like a paid plan, an admin step or a region. `link` goes to
 * the vendor's page about it.
 */
export type CardNote = { text: string; link?: { label: string; url: string } };

/** What a reply shows for one of a connector's tools. */
export type ConnectorToolView = {
  /** What the tool's row in a reply says, like "Searching Notion". */
  label: string;
};

/** One catalog connector as written below. */
type ConnectorViewEntry = {
  /**
   * Lowercase letters and digits. It starts the model's name for each of
   * the connector's tools, so changing it makes old threads lose their
   * tool rows. The logo is `public/connectors/<id>.svg`.
   */
  id: string;
  name: string;
  /**
   * Typed after @ to mention the connector, like `notion`. Set it only when
   * it differs from the id.
   */
  handle?: string;
  description: string;
  /** Shown on the card. Clicking it starts a new chat with this prompt. */
  examplePrompt: string;
  cardNote?: CardNote;
  /**
   * The MCP tools a8 offers the model, by their name on the MCP server, like
   * `notion-search`. Every other tool stays hidden. The server catalog gives
   * each one its kind.
   */
  tools: Record<string, ConnectorToolView>;
};

const ENTRIES = [
  {
    id: "notion",
    name: "Notion",
    description: "Search, read and write pages in your Notion workspace.",
    examplePrompt:
      "@notion find my notes from this week and list the action items",
    tools: {
      "notion-search": { label: "Searching Notion" },
      "notion-fetch": { label: "Reading Notion" },
      "notion-query-data-sources": { label: "Reading a Notion database" },
      "notion-get-comments": { label: "Reading Notion comments" },
      "notion-get-users": { label: "Finding Notion users" },
      "notion-get-teams": { label: "Finding Notion teamspaces" },
      "notion-create-pages": { label: "Creating Notion pages" },
      "notion-update-page": { label: "Updating a Notion page" },
      "notion-move-pages": { label: "Moving Notion pages" },
      "notion-duplicate-page": { label: "Duplicating a Notion page" },
      "notion-create-database": { label: "Creating a Notion database" },
      "notion-create-comment": { label: "Commenting in Notion" },
    },
  },
  {
    id: "linear",
    name: "Linear",
    description: "Find, create and update Linear issues, and comment on them.",
    examplePrompt: "@linear list my open issues, highest priority first",
    tools: {
      list_issues: { label: "Searching Linear issues" },
      get_issue: { label: "Reading a Linear issue" },
      list_comments: { label: "Reading Linear comments" },
      list_projects: { label: "Finding Linear projects" },
      list_teams: { label: "Finding Linear teams" },
      list_users: { label: "Finding Linear users" },
      list_issue_statuses: { label: "Finding Linear statuses" },
      list_issue_labels: { label: "Finding Linear labels" },
      get_workspace: { label: "Reading the Linear workspace" },
      save_issue: { label: "Saving a Linear issue" },
      save_comment: { label: "Commenting in Linear" },
    },
  },
  {
    id: "todoist",
    name: "Todoist",
    description: "Find, add and complete Todoist tasks.",
    examplePrompt: "@todoist what's due today?",
    tools: {
      "find-tasks": { label: "Searching Todoist tasks" },
      "find-tasks-by-date": { label: "Finding Todoist tasks by date" },
      "find-completed-tasks": { label: "Finding completed Todoist tasks" },
      "find-projects": { label: "Finding Todoist projects" },
      "find-sections": { label: "Finding Todoist sections" },
      "find-labels": { label: "Finding Todoist labels" },
      "find-comments": { label: "Reading Todoist comments" },
      "get-overview": { label: "Reading a Todoist project overview" },
      "user-info": { label: "Reading the Todoist account" },
      "add-tasks": { label: "Adding Todoist tasks" },
      "complete-tasks": { label: "Completing Todoist tasks" },
    },
  },
  {
    id: "airtable",
    name: "Airtable",
    description: "Read your Airtable bases, and add or update records.",
    examplePrompt: "@airtable list my bases and the tables in each",
    tools: {
      list_workspaces: { label: "Finding Airtable workspaces" },
      list_bases: { label: "Finding Airtable bases" },
      search_bases: { label: "Searching Airtable bases" },
      list_tables_for_base: { label: "Reading an Airtable base" },
      get_table_schema: { label: "Reading an Airtable table" },
      list_records_for_table: { label: "Reading Airtable records" },
      search_records: { label: "Searching Airtable records" },
      analyze_table: { label: "Analyzing an Airtable table" },
      list_record_comments: { label: "Reading Airtable comments" },
      create_records_for_table: { label: "Adding Airtable records" },
      update_records_for_table: { label: "Updating Airtable records" },
    },
  },
  {
    id: "calendly",
    name: "Calendly",
    description: "See your Calendly event types and meetings, and book or cancel meetings.",
    examplePrompt: "@calendly what meetings do I have this week?",
    cardNote: { text: "Booking needs a paid Calendly plan." },
    tools: {
      "users-get_current_user": { label: "Reading the Calendly account" },
      "event_types-list_event_types": { label: "Finding Calendly event types" },
      "event_types-get_event_type": { label: "Reading a Calendly event type" },
      "event_types-list_event_type_available_times": { label: "Finding open Calendly times" },
      "availability-list_user_busy_times": { label: "Checking Calendly busy times" },
      "meetings-list_events": { label: "Finding Calendly meetings" },
      "meetings-get_event": { label: "Reading a Calendly meeting" },
      "meetings-list_event_invitees": { label: "Finding Calendly invitees" },
      "locations-list_user_meeting_locations": { label: "Finding Calendly meeting locations" },
      "meetings-create_invitee": { label: "Booking a Calendly meeting" },
      "meetings-cancel_event": { label: "Cancelling a Calendly meeting" },
      "scheduling_links-create_single_use_scheduling_link": { label: "Creating a Calendly scheduling link" },
    },
  },
] as const satisfies readonly ConnectorViewEntry[];

/** A catalog connector's id. A typo in one fails the typecheck. */
export type ConnectorId = (typeof ENTRIES)[number]["id"];

/** The MCP names of a catalog connector's tools, like `notion-search`. */
export type ConnectorToolName<Id extends ConnectorId> = keyof Extract<
  (typeof ENTRIES)[number],
  { id: Id }
>["tools"] &
  string;

/** A catalog connector as the UI shows it. */
export type ConnectorView = Omit<ConnectorViewEntry, "id" | "handle"> & {
  id: ConnectorId;
  /** What the user types after @ to mention the connector. */
  handle: string;
  /** Path of the logo under public/. */
  logo: string;
};

/** Every catalog connector, in catalog order. */
export const CONNECTOR_VIEWS: ConnectorView[] = ENTRIES.map(
  (entry: ConnectorViewEntry & { id: ConnectorId }) => ({
    ...entry,
    handle: entry.handle ?? entry.id,
    logo: `/connectors/${entry.id}.svg`,
  }),
);

const VIEWS_BY_ID = new Map(
  CONNECTOR_VIEWS.map((connector) => [connector.id, connector] as const),
);

/**
 * The catalog connector with this id. A stored id is a plain string and can
 * name a connector since removed, so the result can be undefined. A string
 * literal must be a ConnectorId, so a typo fails the typecheck.
 */
export function findConnectorView(id: ConnectorId): ConnectorView;
export function findConnectorView<Id extends string>(
  id: Id & (string extends Id ? unknown : never),
): ConnectorView | undefined;
export function findConnectorView(id: string): ConnectorView | undefined {
  return VIEWS_BY_ID.get(id as ConnectorId);
}

/**
 * Why a sign-in ended without connecting: the user cancelled at the vendor,
 * the sign-in expired or belongs to another user, or a step failed.
 */
export const CONNECT_ERRORS = ["cancelled", "expired", "failed"] as const;
export type ConnectError = (typeof CONNECT_ERRORS)[number];

/**
 * The code a connector tool's error starts with once its connection needs
 * reconnecting. The reply shows a Reconnect chip for a call that failed with
 * it. Saved replies hold it, so never change it.
 */
export const RECONNECT_ERROR_CODE = "NEEDS_RECONNECT";

/** Whether a tool call's error text is a ReconnectError's. */
export function isReconnectError(errorText: string | undefined): boolean {
  return errorText?.startsWith(`${RECONNECT_ERROR_CODE}: `) ?? false;
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
export function findMentions(text: string): ConnectorView[] {
  const handles = new Set(
    Array.from(
      text.matchAll(new RegExp(String.raw`${MENTION_START}@([\w-]+)`, "g")),
      (match) => match[1].toLowerCase(),
    ),
  );
  return CONNECTOR_VIEWS.filter((connector) => handles.has(connector.handle));
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
export function modelToolName(
  connector: { id: string },
  mcpName: string,
): string {
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

/** Every offered tool's connector and label, by the tool's model name. */
const TOOLS_BY_MODEL_NAME = new Map(
  CONNECTOR_VIEWS.flatMap((connector) =>
    Object.entries(connector.tools).map(
      ([name, tool]) =>
        [modelToolName(connector, name), { connector, label: tool.label }] as const,
    ),
  ),
);

/**
 * The connector behind a model tool name, and the label its row shows.
 * Undefined for a8's own tools, like webSearch. A tool a8 no longer offers
 * gets a generic label, so old threads still show it.
 */
export function findConnectorTool(
  modelName: string,
): { connector: ConnectorView; label: string } | undefined {
  const found = TOOLS_BY_MODEL_NAME.get(modelName);
  if (found) return found;
  const connector = CONNECTOR_VIEWS.find((entry) =>
    modelName.startsWith(`${entry.id}__`),
  );
  return connector && { connector, label: `Using ${connector.name}` };
}
