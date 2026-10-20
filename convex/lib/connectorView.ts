// What the browser knows about each catalog connector: its card, its tools
// (label, kind and target), mention parsing and the error codes the UI
// reads, and how replies show a8's own scheduled prompt tools. The UI
// imports this module and never the server catalog (connectors.ts), so
// nothing here may name an MCP server URL, a pinned origin or a sign-in.
//
// Each connector's id, card fields and tools live only here. The server
// catalog keys its entries by these ids and its MCP servers by these server
// keys, so a connector or server missing from either file fails the
// typecheck.

import { ERROR_CODES } from "./errors";
import type { Schedule } from "./schedule";
import { describeSchedule } from "./scheduleText";

/**
 * One line under a card's description about what the user's own account
 * needs first, like a paid plan, an admin step or a region. `link` goes to
 * the vendor's page about it.
 */
export type CardNote = { text: string; link?: { label: string; url: string } };

/**
 * Whether a8 counts a tool as a read or an action. A read runs without
 * asking, unless the server marks the tool not read-only. An action always
 * waits on an action card (ADR 0008).
 */
export type ToolKind = "read" | "action";

/** One tool a8 offers the model: its kind, and what a reply shows for it. */
export type ConnectorToolView = {
  kind: ToolKind;
  /** What the tool's row in a reply says, like "Searching Notion". */
  label: string;
  /**
   * For an action, the input arguments that say where it happens, by their
   * name in the tool's input schema, like `page_id`. Its action card shows
   * them under Target and every other argument under Content. A card for an
   * action without them shows every argument under one heading.
   */
  target?: readonly string[];
};

/** The tools a8 offers from one of a connector's MCP servers. */
export type ConnectorServerView = {
  /**
   * Goes between the connector id and the tool in the model's name for
   * each of this server's tools, like `docs` in `googledrive__docs_get`
   * (modelToolName). Leave it out unless two of the connector's servers
   * would give tools the same model name. Changing it makes old threads
   * lose those tool rows.
   */
  toolPrefix?: string;
  /**
   * The MCP tools a8 offers the model from this server, by their name on
   * the server, like `notion-search`. Every other tool stays hidden.
   */
  tools: Record<string, ConnectorToolView>;
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
   * The guide a deployer follows to set the connector up, for one whose
   * sign-in needs the deployment's own OAuth client. The card links to it
   * while the connector isn't set up.
   */
  setupGuide?: string;
  /**
   * The connector's MCP servers, by a key of lowercase letters and digits.
   * A connector with one server keys it by the connector id. Stored tool
   * lists name each tool's server by this key, so never change one. The
   * server catalog gives each server its URL.
   */
  servers: Record<string, ConnectorServerView>;
};

const ENTRIES = [
  {
    id: "notion",
    name: "Notion",
    description: "Search, read and write pages in your Notion workspace.",
    examplePrompt:
      "@notion find my notes from this week and list the action items",
    servers: {
      notion: {
        tools: {
          "notion-search": { kind: "read", label: "Searching Notion" },
          "notion-fetch": { kind: "read", label: "Reading Notion" },
          "notion-query-data-sources": { kind: "read", label: "Reading a Notion database" },
          "notion-get-comments": { kind: "read", label: "Reading Notion comments" },
          "notion-get-users": { kind: "read", label: "Finding Notion users" },
          "notion-get-teams": { kind: "read", label: "Finding Notion teamspaces" },
          "notion-create-pages": {
            kind: "action",
            label: "Creating Notion pages",
            target: ["parent"],
          },
          "notion-update-page": {
            kind: "action",
            label: "Updating a Notion page",
            target: ["page_id"],
          },
          "notion-move-pages": {
            kind: "action",
            label: "Moving Notion pages",
            target: ["page_or_database_ids", "new_parent"],
          },
          "notion-duplicate-page": {
            kind: "action",
            label: "Duplicating a Notion page",
            target: ["page_id"],
          },
          "notion-create-database": {
            kind: "action",
            label: "Creating a Notion database",
            target: ["parent"],
          },
          "notion-create-comment": {
            kind: "action",
            label: "Commenting in Notion",
            target: ["page_id", "discussion_id"],
          },
        },
      },
    },
  },
  {
    id: "linear",
    name: "Linear",
    description: "Find, create and update Linear issues, and comment on them.",
    examplePrompt: "@linear list my open issues, highest priority first",
    servers: {
      linear: {
        tools: {
          list_issues: { kind: "read", label: "Searching Linear issues" },
          get_issue: { kind: "read", label: "Reading a Linear issue" },
          list_comments: { kind: "read", label: "Reading Linear comments" },
          list_projects: { kind: "read", label: "Finding Linear projects" },
          list_teams: { kind: "read", label: "Finding Linear teams" },
          list_users: { kind: "read", label: "Finding Linear users" },
          list_issue_statuses: { kind: "read", label: "Finding Linear statuses" },
          list_issue_labels: { kind: "read", label: "Finding Linear labels" },
          get_workspace: { kind: "read", label: "Reading the Linear workspace" },
          // Both save tools create without `id` and update the item with it.
          save_issue: {
            kind: "action",
            label: "Saving a Linear issue",
            target: ["id", "team", "project", "parentId"],
          },
          save_comment: {
            kind: "action",
            label: "Commenting in Linear",
            target: [
              "id",
              "issueId",
              "projectId",
              "initiativeId",
              "documentId",
              "milestoneId",
              "statusUpdateId",
              "parentId",
            ],
          },
        },
      },
    },
  },
  {
    id: "todoist",
    name: "Todoist",
    description: "Find, add and complete Todoist tasks.",
    examplePrompt: "@todoist what's due today?",
    servers: {
      todoist: {
        tools: {
          "find-tasks": { kind: "read", label: "Searching Todoist tasks" },
          "find-tasks-by-date": { kind: "read", label: "Finding Todoist tasks by date" },
          "find-completed-tasks": { kind: "read", label: "Finding completed Todoist tasks" },
          "find-projects": { kind: "read", label: "Finding Todoist projects" },
          "find-sections": { kind: "read", label: "Finding Todoist sections" },
          "find-labels": { kind: "read", label: "Finding Todoist labels" },
          "find-comments": { kind: "read", label: "Reading Todoist comments" },
          "get-overview": { kind: "read", label: "Reading a Todoist project overview" },
          "user-info": { kind: "read", label: "Reading the Todoist account" },
          // Each task names its own project inside `tasks`, so no top-level
          // argument is the target.
          "add-tasks": { kind: "action", label: "Adding Todoist tasks" },
          "complete-tasks": {
            kind: "action",
            label: "Completing Todoist tasks",
            target: ["ids"],
          },
        },
      },
    },
  },
  {
    id: "airtable",
    name: "Airtable",
    description: "Read your Airtable bases, and add or update records.",
    examplePrompt: "@airtable list my bases and the tables in each",
    servers: {
      airtable: {
        tools: {
          list_workspaces: { kind: "read", label: "Finding Airtable workspaces" },
          list_bases: { kind: "read", label: "Finding Airtable bases" },
          search_bases: { kind: "read", label: "Searching Airtable bases" },
          list_tables_for_base: { kind: "read", label: "Reading an Airtable base" },
          get_table_schema: { kind: "read", label: "Reading an Airtable table" },
          list_records_for_table: { kind: "read", label: "Reading Airtable records" },
          search_records: { kind: "read", label: "Searching Airtable records" },
          analyze_table: { kind: "read", label: "Analyzing an Airtable table" },
          list_record_comments: { kind: "read", label: "Reading Airtable comments" },
          create_records_for_table: {
            kind: "action",
            label: "Adding Airtable records",
            target: ["baseId", "tableId"],
          },
          update_records_for_table: {
            kind: "action",
            label: "Updating Airtable records",
            target: ["baseId", "tableId"],
          },
        },
      },
    },
  },
  {
    id: "calendly",
    name: "Calendly",
    description: "See your Calendly event types and meetings, and book or cancel meetings.",
    examplePrompt: "@calendly what meetings do I have this week?",
    cardNote: { text: "Booking needs a paid Calendly plan." },
    servers: {
      calendly: {
        tools: {
          "users-get_current_user": { kind: "read", label: "Reading the Calendly account" },
          "event_types-list_event_types": { kind: "read", label: "Finding Calendly event types" },
          "event_types-get_event_type": { kind: "read", label: "Reading a Calendly event type" },
          "event_types-list_event_type_available_times": { kind: "read", label: "Finding open Calendly times" },
          "availability-list_user_busy_times": { kind: "read", label: "Checking Calendly busy times" },
          "meetings-list_events": { kind: "read", label: "Finding Calendly meetings" },
          "meetings-get_event": { kind: "read", label: "Reading a Calendly meeting" },
          "meetings-list_event_invitees": { kind: "read", label: "Finding Calendly invitees" },
          "locations-list_user_meeting_locations": { kind: "read", label: "Finding Calendly meeting locations" },
          // The actions below mark no target until someone checks their input
          // schemas on a signed-in probe.
          "meetings-create_invitee": { kind: "action", label: "Booking a Calendly meeting" },
          "meetings-cancel_event": { kind: "action", label: "Cancelling a Calendly meeting" },
          "scheduling_links-create_single_use_scheduling_link": { kind: "action", label: "Creating a Calendly scheduling link" },
        },
      },
    },
  },
  {
    id: "excalidraw",
    name: "Excalidraw",
    description: "Draw diagrams and get a link to open them in Excalidraw.",
    examplePrompt:
      "@excalidraw draw a flowchart of a user signing up and verifying their email",
    servers: {
      excalidraw: {
        tools: {
          // The server's other tools draw inside an MCP Apps host's chat,
          // and a8 isn't one. read_me teaches their format, and
          // excalidraw.com drops parts of it, like shape labels. Uploading
          // puts the diagram at a link anyone with it can open, so it asks.
          export_to_excalidraw: {
            kind: "action",
            label: "Uploading a diagram to Excalidraw",
          },
        },
      },
    },
  },
  {
    id: "trello",
    name: "Trello",
    description: "Read your Trello boards, and add or change cards, lists and checklists.",
    examplePrompt: "@trello what's on my boards this week?",
    cardNote: { text: "One workspace per connection." },
    servers: {
      trello: {
        tools: {
          trelloSearch: { kind: "read", label: "Searching Trello" },
          trelloReadMember: { kind: "read", label: "Reading Trello members" },
          trelloReadWorkspace: { kind: "read", label: "Reading the Trello workspace" },
          trelloReadBoard: { kind: "read", label: "Reading Trello boards" },
          trelloReadList: { kind: "read", label: "Reading Trello lists" },
          trelloReadCard: { kind: "read", label: "Reading Trello cards" },
          trelloReadChecklist: { kind: "read", label: "Reading Trello checklists" },
          trelloReadInbox: { kind: "read", label: "Reading the Trello Inbox" },
          // Most write tools run several operations, like create, move and
          // archive, picked by their `action` argument. That argument says
          // what happens, not where, so it isn't a target.
          trelloWriteCard: {
            kind: "action",
            label: "Changing a Trello card",
            target: ["cardId", "listId", "boardId", "commentId"],
          },
          trelloWriteList: {
            kind: "action",
            label: "Changing a Trello list",
            target: ["listId", "boardId"],
          },
          trelloWriteChecklist: {
            kind: "action",
            label: "Changing a Trello checklist",
            target: ["cardId", "checklistId", "itemId", "toChecklistId"],
          },
          trelloWriteBoard: {
            kind: "action",
            label: "Creating a Trello board",
            target: ["workspaceId"],
          },
        },
      },
    },
  },
  {
    id: "googlecalendar",
    name: "Google Calendar",
    handle: "calendar",
    description: "See your Google Calendar events, find free times, and add, change or delete events.",
    examplePrompt: "@calendar what's on my calendar this week?",
    setupGuide:
      "https://github.com/abdtriedcoding/a8-chat/blob/main/docs/connectors/google.md",
    servers: {
      googlecalendar: {
        tools: {
          list_events: { kind: "read", label: "Reading Google Calendar events" },
          search_events: { kind: "read", label: "Searching Google Calendar" },
          get_event: { kind: "read", label: "Reading a Google Calendar event" },
          list_calendars: { kind: "read", label: "Finding Google calendars" },
          suggest_time: { kind: "read", label: "Finding free times" },
          create_event: {
            kind: "action",
            label: "Adding a Google Calendar event",
            target: ["calendarId"],
          },
          update_event: {
            kind: "action",
            label: "Changing a Google Calendar event",
            target: ["calendarId", "eventId"],
          },
          delete_event: {
            kind: "action",
            label: "Deleting a Google Calendar event",
            target: ["calendarId", "eventId"],
          },
          respond_to_event: {
            kind: "action",
            label: "Replying to a Google Calendar invite",
            target: ["calendarId", "eventId"],
          },
        },
      },
    },
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Search and read your email, and write drafts you send from Gmail.",
    examplePrompt: "@gmail what needs a reply from me this week?",
    setupGuide:
      "https://github.com/abdtriedcoding/a8-chat/blob/main/docs/connectors/google.md",
    servers: {
      gmail: {
        tools: {
          search_threads: { kind: "read", label: "Searching Gmail" },
          get_thread: { kind: "read", label: "Reading a Gmail thread" },
          get_message: { kind: "read", label: "Reading an email" },
          list_drafts: { kind: "read", label: "Finding Gmail drafts" },
          get_draft: { kind: "read", label: "Reading a Gmail draft" },
          list_labels: { kind: "read", label: "Finding Gmail labels" },
          // Gmail's server has no send tool, so the user sends the draft
          // from Gmail (ADR 0007).
          create_draft: {
            kind: "action",
            label: "Writing a Gmail draft",
            target: ["to", "cc", "bcc", "replyToMessageId"],
          },
        },
      },
    },
  },
  {
    id: "googledrive",
    name: "Google Drive",
    handle: "drive",
    description: "Search Google Drive, and read and edit your Docs, Sheets and Slides.",
    examplePrompt: "@drive find my most recent doc and summarize it",
    setupGuide:
      "https://github.com/abdtriedcoding/a8-chat/blob/main/docs/connectors/google.md",
    // The four servers' tool names don't clash, so none has a toolPrefix.
    servers: {
      drive: {
        tools: {
          search_files: { kind: "read", label: "Searching Google Drive" },
          list_recent_files: { kind: "read", label: "Finding recent Drive files" },
          read_file_content: { kind: "read", label: "Reading a Drive file" },
          // Creates a Doc, Sheet, Slides deck or folder, picked by its
          // `contentMimeType`, or uploads content.
          create_file: {
            kind: "action",
            label: "Creating a Drive file",
            target: ["parentId"],
          },
        },
      },
      docs: {
        tools: {
          read_doc: { kind: "read", label: "Reading a Google Doc" },
          update_doc: {
            kind: "action",
            label: "Editing a Google Doc",
            target: ["documentId"],
          },
        },
      },
      sheets: {
        tools: {
          get_spreadsheet: { kind: "read", label: "Reading a Google Sheet" },
          get_values: { kind: "read", label: "Reading Google Sheet cells" },
          update_values: {
            kind: "action",
            label: "Updating Google Sheet cells",
            target: ["spreadsheetId", "range"],
          },
          update_spreadsheet: {
            kind: "action",
            label: "Changing a Google Sheet",
            target: ["spreadsheetId"],
          },
        },
      },
      slides: {
        tools: {
          read_presentation: { kind: "read", label: "Reading Google Slides" },
          update_presentation: {
            kind: "action",
            label: "Editing Google Slides",
            target: ["presentationId"],
          },
        },
      },
    },
  },
  {
    id: "googledocs",
    name: "Google Docs",
    handle: "docs",
    description: "Find, read and edit your Google Docs, and create new ones.",
    examplePrompt: "@docs find my latest doc and list its open questions",
    setupGuide:
      "https://github.com/abdtriedcoding/a8-chat/blob/main/docs/connectors/google.md",
    // Docs' server only reads and edits a doc by its ID, so Drive's server
    // finds and creates docs.
    servers: {
      drive: {
        tools: {
          search_files: { kind: "read", label: "Searching Google Docs" },
          list_recent_files: { kind: "read", label: "Finding recent Google Docs" },
          // Makes a blank Doc when `contentMimeType` is a Google Doc's.
          create_file: {
            kind: "action",
            label: "Creating a Google Doc",
            target: ["parentId"],
          },
          copy_file: {
            kind: "action",
            label: "Copying a Google Doc",
            target: ["fileId", "parentId"],
          },
        },
      },
      docs: {
        tools: {
          read_doc: { kind: "read", label: "Reading a Google Doc" },
          update_doc: {
            kind: "action",
            label: "Editing a Google Doc",
            target: ["documentId"],
          },
        },
      },
    },
  },
  {
    id: "googlesheets",
    name: "Google Sheets",
    handle: "sheets",
    description: "Find, read and edit your Google Sheets, and create new ones.",
    examplePrompt: "@sheets find my latest sheet and sum its last column",
    setupGuide:
      "https://github.com/abdtriedcoding/a8-chat/blob/main/docs/connectors/google.md",
    // Sheets' server only reads and edits a sheet by its ID, so Drive's
    // server finds and creates sheets.
    servers: {
      drive: {
        tools: {
          search_files: { kind: "read", label: "Searching Google Sheets" },
          list_recent_files: { kind: "read", label: "Finding recent Google Sheets" },
          // Makes a blank Sheet when `contentMimeType` is a Google Sheet's.
          create_file: {
            kind: "action",
            label: "Creating a Google Sheet",
            target: ["parentId"],
          },
          copy_file: {
            kind: "action",
            label: "Copying a Google Sheet",
            target: ["fileId", "parentId"],
          },
        },
      },
      sheets: {
        tools: {
          get_spreadsheet: { kind: "read", label: "Reading a Google Sheet" },
          get_values: { kind: "read", label: "Reading Google Sheet cells" },
          update_values: {
            kind: "action",
            label: "Updating Google Sheet cells",
            target: ["spreadsheetId", "range"],
          },
          update_formulas: {
            kind: "action",
            label: "Updating Google Sheet formulas",
            target: ["spreadsheetId", "range"],
          },
          insert_dimension: {
            kind: "action",
            label: "Inserting Google Sheet rows or columns",
            target: ["spreadsheetId", "sheetId"],
          },
          update_spreadsheet: {
            kind: "action",
            label: "Changing a Google Sheet",
            target: ["spreadsheetId"],
          },
        },
      },
    },
  },
  {
    id: "googleslides",
    name: "Google Slides",
    handle: "slides",
    description: "Find, read and edit your Google Slides, and create new ones.",
    examplePrompt: "@slides find my latest deck and list each slide's title",
    setupGuide:
      "https://github.com/abdtriedcoding/a8-chat/blob/main/docs/connectors/google.md",
    // Slides' server only reads and edits a deck by its ID, so Drive's
    // server finds and creates decks.
    servers: {
      drive: {
        tools: {
          search_files: { kind: "read", label: "Searching Google Slides" },
          list_recent_files: { kind: "read", label: "Finding recent Google Slides" },
          // Makes a blank deck when `contentMimeType` is a Google Slides deck's.
          create_file: {
            kind: "action",
            label: "Creating a Google Slides deck",
            target: ["parentId"],
          },
          copy_file: {
            kind: "action",
            label: "Copying a Google Slides deck",
            target: ["fileId", "parentId"],
          },
        },
      },
      slides: {
        tools: {
          read_presentation: { kind: "read", label: "Reading Google Slides" },
          read_slide_page: { kind: "read", label: "Reading a Google Slides slide" },
          // Returns a link to a PNG of the slide, with its size.
          read_slide_page_thumbnail: {
            kind: "read",
            label: "Getting a Google Slides thumbnail",
          },
          update_presentation: {
            kind: "action",
            label: "Editing Google Slides",
            target: ["presentationId"],
          },
        },
      },
    },
  },
] as const satisfies readonly ConnectorViewEntry[];

/** A catalog connector's id. A typo in one fails the typecheck. */
export type ConnectorId = (typeof ENTRIES)[number]["id"];

type Entry<Id extends ConnectorId> = Extract<
  (typeof ENTRIES)[number],
  { id: Id }
>;

/** The keys of a catalog connector's MCP servers, like `notion`. */
export type ServerKey<Id extends ConnectorId> = keyof Entry<Id>["servers"] &
  string;

/** The MCP names of a catalog connector's tools on all its servers. */
export type ConnectorToolName<Id extends ConnectorId> = {
  [Key in ServerKey<Id>]: Entry<Id>["servers"][Key] extends {
    tools: infer Tools;
  }
    ? keyof Tools & string
    : never;
}[ServerKey<Id>];

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
 * the sign-in expired or belongs to another user, this deployment or the
 * catalog entry is set up wrong, the vendor couldn't be reached, the vendor
 * rejected a8's client registration, or another step failed.
 */
export const CONNECT_ERRORS = [
  "cancelled",
  "expired",
  "misconfigured",
  "unreachable",
  "rejected_client",
  "failed",
] as const;
export type ConnectError = (typeof CONNECT_ERRORS)[number];

/**
 * The code a connector tool's error starts with once its connection needs
 * reconnecting. The reply shows a Reconnect chip for a call that failed with
 * it. Saved replies hold it, so never change it.
 */
export const RECONNECT_ERROR_CODE = ERROR_CODES.NEEDS_RECONNECT;

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
 * The model's name for a connector's tool, `<connector id>__<tool>`, or
 * `<connector id>__<prefix>_<tool>` on a server with a `toolPrefix`. A
 * prefix of the connector's ID, or of the server's `toolPrefix`, that the
 * vendor puts on its own names is dropped, so `notion-search` becomes
 * `notion__search`. Characters outside `[a-zA-Z0-9_-]` become `_`, and a
 * name over 64 characters is cut short. Either way the name then ends in a
 * hash of the vendor's name, so `a.b` and `a_b` still get different names.
 */
export function modelToolName(
  connector: { id: string },
  server: { toolPrefix?: string },
  mcpName: string,
): string {
  const { toolPrefix } = server;
  const dropped = toolPrefix ?? connector.id;
  const tool =
    mcpName.startsWith(dropped) &&
    ["-", "_", "."].includes(mcpName.charAt(dropped.length))
      ? mcpName.slice(dropped.length + 1)
      : mcpName;
  const start =
    toolPrefix === undefined
      ? `${connector.id}__`
      : `${connector.id}__${toolPrefix}_`;
  const full = `${start}${tool}`;
  const name = full.replace(/[^a-zA-Z0-9_-]/g, "_");
  if (name === full && name.length <= MAX_TOOL_NAME_LENGTH) return name;
  const hash = fnv1a(`${start}${mcpName}`);
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

/** A connector tool as a reply shows it: its connector, label and target. */
export type FoundConnectorTool = Omit<ConnectorToolView, "kind"> & {
  connector: ConnectorView;
};

/** Every offered tool's connector, label and target, by the tool's model name. */
const TOOLS_BY_MODEL_NAME = new Map(
  CONNECTOR_VIEWS.flatMap((connector) =>
    Object.values(connector.servers).flatMap((server) =>
      Object.entries(server.tools).map(
        ([name, tool]): [string, FoundConnectorTool] => [
          modelToolName(connector, server, name),
          { connector, ...tool },
        ],
      ),
    ),
  ),
);

/**
 * The connector behind a model tool name, the label its row shows and its
 * target arguments. Undefined for a8's own tools, like webSearch. A tool a8
 * no longer offers gets a generic label and no target, so old threads still
 * show it.
 */
export function findConnectorTool(
  modelName: string,
): FoundConnectorTool | undefined {
  const found = TOOLS_BY_MODEL_NAME.get(modelName);
  if (found) return found;
  const connector = CONNECTOR_VIEWS.find((entry) =>
    modelName.startsWith(`${entry.id}__`),
  );
  return connector && { connector, label: `Using ${connector.name}` };
}

/** The app a tool works in, as a reply shows it: a connector, or a8 itself. */
export type ToolApp = Pick<ConnectorView, "name" | "logo">;

/** a8 itself, as the app of its own scheduled prompt tools. */
export const A8_APP: ToolApp = { name: "a8", logo: "/icon.svg" };

/**
 * a8's tools for the user's scheduled prompts (convex/tools/
 * scheduledPrompts.ts), by their model name. Their actions wait on a card
 * like a connector's (ADR 0013). Their names are saved in threads, so never
 * change one.
 */
export const A8_TOOLS = {
  listScheduledPrompts: { kind: "read", label: "Reading scheduled tasks" },
  createScheduledPrompt: {
    kind: "action",
    label: "Creating a scheduled task",
    target: ["title"],
  },
  updateScheduledPrompt: {
    kind: "action",
    label: "Changing a scheduled task",
    target: ["title"],
  },
  deleteScheduledPrompt: {
    kind: "action",
    label: "Deleting a scheduled task",
    target: ["title"],
  },
} as const satisfies Record<string, ConnectorToolView>;

export type A8ToolName = keyof typeof A8_TOOLS;

/** One of a8's own tools as a reply shows it. */
export type FoundA8Tool = Omit<ConnectorToolView, "kind"> & {
  app: ToolApp;
  /**
   * The arguments its action card shows, in place of the input: the
   * schedule in words, and no IDs.
   */
  cardInput: (input: Record<string, unknown>) => Record<string, unknown>;
};

/**
 * One of a8's own tools that its rows and cards show, with a8 as the app.
 * Undefined for any other tool, and for webSearch, which has rows of its own.
 */
export function findA8Tool(modelName: string): FoundA8Tool | undefined {
  if (!Object.hasOwn(A8_TOOLS, modelName)) return undefined;
  const { label, ...tool } = A8_TOOLS[modelName as A8ToolName];
  return {
    app: A8_APP,
    label,
    ...("target" in tool && { target: tool.target }),
    cardInput: scheduledPromptCardInput,
  };
}

/**
 * A scheduled prompt tool's input as its card shows it: the title, a new
 * title, the prompt, the schedule in words and, for a change, the time
 * zone it runs in. The model writes the input,
 * so a schedule describeSchedule can't read shows as it came.
 */
function scheduledPromptCardInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const { title, newTitle, prompt, schedule, timeZone } = input;
  let scheduleText = schedule;
  try {
    // An unknown kind gives undefined.
    scheduleText = describeSchedule(schedule as Schedule) ?? schedule;
  } catch {
    // Shows the schedule as the model wrote it.
  }
  return Object.fromEntries(
    Object.entries({
      title,
      newTitle,
      prompt,
      schedule: scheduleText,
      timeZone,
    }).filter(([, value]) => value !== undefined),
  );
}
