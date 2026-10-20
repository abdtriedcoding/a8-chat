/**
 * What an action card leads with: one sentence on what happens, the item's
 * name, a few short fields and a preview of the body. The card keeps the
 * full arguments under "Show details", so a summary only picks what a
 * person needs to decide.
 *
 * Each summary reads the call's real input. The model never writes it, so
 * the card can't say something other than what runs. Field names follow
 * each server's tool schema: Google's are in its MCP reference
 * (developers.google.com/workspace/calendar/api/v3/reference/mcp), and
 * Notion's and Todoist's are in the stored tool lists.
 */
export type ActionSummary = {
  /** Like "Create a Notion page". */
  headline: string;
  /** The approve button's label, like "Create page". */
  verb: string;
  /** The item's name, like the page title or the email subject. */
  title?: string;
  fields: { label: string; value: string }[];
  /** The body as plain text, cut to a few lines on the card. */
  preview?: string;
  /** A line under the fields, like "Saved as a draft". */
  note?: string;
  /** Deletes or overwrites something. The card warns and colors the button. */
  destructive?: boolean;
};

/**
 * An item the thread's earlier tool results named, like an event that
 * list_events returned. Actions often name their target by ID only, so the
 * card looks the ID up here.
 */
export type KnownItem = { name: string; when?: string; guests?: number };

export type KnownItems = ReadonlyMap<string, KnownItem>;

type Summarize = (
  input: Record<string, unknown>,
  known: (id: unknown) => KnownItem | undefined,
) => ActionSummary;

/** Summaries by the tool's model name, like `gmail__create_draft`. */
const SUMMARIES: Record<string, Summarize> = {
  "notion__create-pages": (input, known) => {
    const pages = list(input.pages).filter(isRecord);
    const page = pages[0] ?? {};
    const many = pages.length > 1;
    const parent = known(parentId(input.parent))?.name;
    return {
      headline: many
        ? `Create ${pages.length} Notion pages`
        : "Create a Notion page",
      verb: many ? "Create pages" : "Create page",
      title: many
        ? pages.map((p) => notionTitle(p) ?? "Untitled").join(", ")
        : (notionTitle(page) ?? "Untitled"),
      fields: [
        {
          label: "Where",
          value: parent
            ? `Inside "${parent}"`
            : input.parent
              ? "Inside an existing page"
              : "Your private pages in Notion",
        },
      ],
      preview: many ? undefined : plainText(page.content),
      note: input.creation_mode === "draft" ? "Created as a draft." : undefined,
    };
  },
  "notion__update-page": (input, known) => {
    const command = text(input.command);
    const replaces = command === "replace_content";
    return {
      headline: replaces
        ? "Replace a Notion page's content"
        : "Update a Notion page",
      verb: "Update page",
      title: known(input.page_id)?.name,
      fields: compact([
        ["Change", command && NOTION_COMMANDS[command]],
        [
          "New title",
          isRecord(input.properties) ? text(input.properties.title) : undefined,
        ],
      ]),
      preview: plainText(input.new_str ?? input.content),
      note: replaces ? "The page's current content is replaced." : undefined,
      destructive: replaces,
    };
  },
  gmail__create_draft: (input) => {
    const files = list(input.attachments)
      .filter(isRecord)
      .map((file) => text(file.filename) ?? "file");
    return {
      headline: input.replyToMessageId
        ? "Write a Gmail reply draft"
        : "Write a Gmail draft",
      verb: "Save draft",
      title: text(input.subject) ?? "(no subject)",
      fields: compact([
        ["To", people(input.to)],
        ["Cc", people(input.cc)],
        ["Bcc", people(input.bcc)],
        ["Files", files.length > 0 ? files.join(", ") : undefined],
      ]),
      preview: plainText(input.body ?? input.htmlBody),
      note: "Nothing is sent. The draft waits in Gmail for you to send.",
    };
  },
  googlecalendar__create_event: (input) => {
    const guests = people(input.attendees ?? input.attendeeEmails);
    return {
      headline: "Add a Google Calendar event",
      verb: "Add event",
      title: text(input.summary) ?? "Untitled event",
      fields: compact([
        ["When", eventTime(input)],
        ["Where", text(input.location)],
        ["Meet", meetLink(input)],
        ["Guests", guests],
        ["Repeats", list(input.recurrenceData).length > 0 ? "Yes" : undefined],
      ]),
      preview: plainText(input.description),
      note: guests
        ? guestEmailNote(input.notificationLevel, "an invite")
        : undefined,
    };
  },
  googlecalendar__update_event: (input, known) => {
    const event = known(input.eventId);
    const added = people(input.addedAttendees ?? input.addedAttendeeEmails);
    const removed = people(input.removedAttendeeEmails);
    const newTitle = text(input.summary);
    return {
      headline: "Change a Google Calendar event",
      verb: "Save changes",
      title: event?.name ?? newTitle,
      fields: compact([
        ["Now", event?.when],
        ["New title", event && newTitle !== event.name ? newTitle : undefined],
        ["New time", eventTime(input)],
        ["Where", text(input.location)],
        ["Meet", meetLink(input)],
        ["Add guests", added],
        ["Remove guests", removed],
      ]),
      preview: plainText(input.description),
      note:
        (event?.guests ?? 0) > 0 || added || removed
          ? guestEmailNote(input.notificationLevel, "an update")
          : undefined,
    };
  },
  googlecalendar__delete_event: (input, known) => {
    const event = known(input.eventId);
    const emailed =
      (event?.guests ?? 0) > 0 && input.notificationLevel !== "NONE";
    return {
      headline: "Delete a Google Calendar event",
      verb: "Delete event",
      title: event?.name,
      fields: compact([["When", event?.when]]),
      note: emailed
        ? `This can't be undone. ${guestCount(event?.guests)} get a cancellation email.`
        : "This can't be undone.",
      destructive: true,
    };
  },
  linear__save_issue: (input, known) => ({
    headline: input.id ? "Update a Linear issue" : "Create a Linear issue",
    verb: input.id ? "Update issue" : "Create issue",
    title: text(input.title) ?? known(input.id)?.name ?? text(input.id),
    fields: compact([
      ["Team", text(input.team)],
      ["Project", text(input.project)],
      ["Status", text(input.state)],
      ["Assignee", text(input.assignee)],
      ["Priority", linearPriority(input.priority)],
    ]),
    preview: plainText(input.description),
  }),
  "todoist__add-tasks": (input) => {
    const tasks = list(input.tasks).filter(isRecord);
    return {
      headline:
        tasks.length === 1
          ? "Add a Todoist task"
          : `Add ${tasks.length} Todoist tasks`,
      verb: tasks.length === 1 ? "Add task" : "Add tasks",
      fields: tasks.map((task, i) => ({
        label:
          text(task.dueString) ?? text(task.deadlineDate) ?? `Task ${i + 1}`,
        value: plainText(task.content) ?? "Untitled",
      })),
    };
  },
};

/**
 * The summary for a tool's call, or undefined for a tool without one.
 * `known` holds the items the thread's earlier results named.
 */
export function summarizeAction(
  toolName: string | undefined,
  input: Record<string, unknown>,
  known: KnownItems = new Map(),
): ActionSummary | undefined {
  const summarize = toolName ? SUMMARIES[toolName] : undefined;
  if (!summarize) return undefined;
  // The model writes the input, so a field of the wrong type shouldn't
  // break the card. The card falls back to the plain argument list.
  try {
    return summarize(input, (id) => {
      const key = itemKey(id);
      return key ? known.get(key) : undefined;
    });
  } catch {
    return undefined;
  }
}

/**
 * The items named in tool results, by ID. A result is the text the app
 * returned, usually JSON. Anything with an `id` and a `summary`, `title`
 * or `name` counts, like a Notion search hit or a Calendar event.
 */
export function knownItems(outputs: unknown[]): KnownItems {
  const items = new Map<string, KnownItem>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 8) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    const key = itemKey(value.id);
    const name =
      text(value.summary) ??
      text(value.title) ??
      text(value.name) ??
      notionTitle(value);
    if (key && name && !items.has(key)) {
      const guests = list(value.attendees).filter(
        (person) => !(isRecord(person) && person.self === true),
      ).length;
      items.set(key, {
        name,
        when: eventTime({ startTime: value.start, endTime: value.end }),
        guests: guests > 0 ? guests : undefined,
      });
    }
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  for (const output of outputs) visit(parseResult(output), 0);
  return items;
}

/** A result's JSON, from inside the untrusted-content tags a8 wraps it in. */
function parseResult(output: unknown): unknown {
  // A stored result can be the model output part, `{ type, value }`.
  if (isRecord(output) && typeof output.value === "string") {
    return parseResult(output.value);
  }
  if (typeof output !== "string") return output;
  const start = output.search(/[[{]/);
  const end = Math.max(output.lastIndexOf("}"), output.lastIndexOf("]"));
  if (start === -1 || end < start) return undefined;
  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/**
 * An ID as a lookup key. Notion takes its IDs with or without dashes, and
 * links end in one, so the key keeps only the letters and digits.
 */
function itemKey(id: unknown): string | undefined {
  const raw = text(id);
  if (!raw) return undefined;
  const notionId = /([0-9a-f]{32})(?:[?#].*)?$/i.exec(raw.replaceAll("-", ""));
  return (notionId?.[1] ?? raw).toLowerCase();
}

const NOTION_COMMANDS: Record<string, string> = {
  update_properties: "Properties",
  update_content: "Edits part of the content",
  replace_content: "Replaces all content",
  insert_content: "Adds content",
  apply_template: "Applies a template",
  update_verification: "Verification",
};

function notionTitle(page: Record<string, unknown>): string | undefined {
  return isRecord(page.properties) ? text(page.properties.title) : undefined;
}

/** The ID in a Notion `parent`, like `{ page_id }`. */
function parentId(parent: unknown): unknown {
  if (!isRecord(parent)) return parent;
  return parent.page_id ?? parent.database_id ?? parent.data_source_id;
}

const LINEAR_PRIORITIES = ["None", "Urgent", "High", "Medium", "Low"];

function linearPriority(value: unknown): string | undefined {
  return typeof value === "number" ? LINEAR_PRIORITIES[value] : text(value);
}

function meetLink(input: Record<string, unknown>): string | undefined {
  if (text(input.googleMeetUrl)) return text(input.googleMeetUrl);
  return input.addGoogleMeetUrl === true ? "Adds a Meet link" : undefined;
}

/** Who Calendar emails, by the call's `notificationLevel`. */
function guestEmailNote(level: unknown, email: string): string {
  if (level === "NONE") return "Guests get no email.";
  if (level === "EXTERNAL_ONLY") {
    return `Only guests outside your organization get ${email} email.`;
  }
  return `Guests get ${email} email.`;
}

function guestCount(guests: number | undefined): string {
  return guests === 1 ? "Its 1 guest" : `Its ${guests} guests`;
}

/** Fields without a value left out. */
function compact(
  pairs: [string, string | undefined][],
): ActionSummary["fields"] {
  return pairs.flatMap(([label, value]) => (value ? [{ label, value }] : []));
}

function text(value: unknown): string | undefined {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

/** Emails as a list, from strings or `{ email }` objects. */
function people(value: unknown): string | undefined {
  const emails = list(value).flatMap((person) => {
    const email = isRecord(person)
      ? (text(person.displayName) ?? text(person.email))
      : text(person);
    return email ? email.split(",").map((e) => e.trim()) : [];
  });
  return emails.length > 0 ? emails.join(", ") : undefined;
}

/**
 * Markdown or HTML as plain text, for a preview: no heading marks, emphasis,
 * link targets or tags. List items keep a bullet.
 */
function plainText(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  return text(
    raw
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/gm, "$1• ")
      .replace(/^(\s*)[-*+]\s+/gm, "$1• ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
      .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?!\w)/g, "$1$2")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\n{3,}/g, "\n\n"),
  );
}

/**
 * An event's time in words, like "Tue, Oct 21, 10:00 AM to 10:30 AM".
 * Reads Calendar's input (`startTime`, `endTime`, `timeZone`, `allDay`) and
 * its events' `{ dateTime }` or `{ date }` objects.
 */
function eventTime(input: Record<string, unknown>): string | undefined {
  const timeZone = validTimeZone(input.timeZone);
  const from = moment(input.startTime, timeZone);
  if (!from) return undefined;
  const to = moment(input.endTime, timeZone);
  const allDay = input.allDay === true || from.dateOnly;
  const start = format(from, { day: true, time: !allDay });
  let range = start;
  if (to) {
    const sameDay = dayKey(from) === dayKey(to);
    if (allDay && !sameDay) {
      range = `${start} to ${format(to, { day: true, time: false })}`;
    } else if (!allDay) {
      range = `${start} to ${format(to, { day: !sameDay, time: true })}`;
    }
  }
  if (allDay) range += " (all day)";
  // Name the zone when it isn't the user's own.
  const zone = from.timeZone;
  return zone && zone !== localTimeZone() ? `${range} (${zone})` : range;
}

type Moment = {
  date: Date;
  timeZone?: string;
  dateOnly: boolean;
  /** Written without an offset, so `date` holds the wall clock as UTC. */
  wallClock: boolean;
};

/**
 * A time from an ISO string or a `{ dateTime, date, timeZone }` object. A
 * time without an offset is the wall clock in `timeZone`, so it shows as
 * written, not moved into the browser's zone.
 */
function moment(value: unknown, timeZone?: string): Moment | undefined {
  const raw = isRecord(value)
    ? (text(value.dateTime) ?? text(value.date))
    : text(value);
  if (!raw) return undefined;
  const zone =
    timeZone ?? (isRecord(value) ? validTimeZone(value.timeZone) : undefined);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const hasOffset = /(z|[+-]\d{2}:?\d{2})$/i.test(raw);
  if (dateOnly || !hasOffset) {
    const date = new Date(`${dateOnly ? `${raw}T00:00:00` : raw}Z`);
    if (Number.isNaN(date.getTime())) return undefined;
    return { date, timeZone: zone, dateOnly, wallClock: true };
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return undefined;
  return { date, timeZone: zone, dateOnly: false, wallClock: false };
}

function format(
  { date, timeZone, wallClock }: Moment,
  parts: { day: boolean; time: boolean },
): string {
  return date.toLocaleString(undefined, {
    timeZone: wallClock ? "UTC" : timeZone,
    ...(parts.day && { weekday: "short", month: "short", day: "numeric" }),
    ...(parts.time && { hour: "numeric", minute: "2-digit" }),
  });
}

function dayKey(moment: Moment): string {
  return format(moment, { day: true, time: false });
}

function validTimeZone(value: unknown): string | undefined {
  const zone = text(value);
  if (!zone) return undefined;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
