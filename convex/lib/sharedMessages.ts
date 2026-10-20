// What a shared snapshot keeps of a message (convex/sharedSnapshots.ts).
// Redaction keeps only the part types listed here, so a part type added
// later stays out of shared snapshots until it's added to this file.

import type { UIMessage } from "@convex-dev/agent";
import { v, type Infer } from "convex/values";
import { findA8Tool, findConnectorTool } from "./connectorView";

const vSharedTextPart = v.object({
  type: v.literal("text"),
  text: v.string(),
});

/** An attachment on a prompt. Its URL is the file's storage URL. */
const vSharedFilePart = v.object({
  type: v.literal("file"),
  mediaType: v.string(),
  url: v.string(),
  filename: v.optional(v.string()),
});

/** A web search with its query and, once it finished, its results. */
const vSharedWebSearchPart = v.object({
  type: v.literal("tool-webSearch"),
  toolCallId: v.string(),
  state: v.string(),
  input: v.optional(v.object({ query: v.optional(v.string()) })),
  output: v.optional(
    v.array(
      v.object({
        title: v.string(),
        url: v.string(),
        snippet: v.string(),
        publishedDate: v.optional(v.string()),
      }),
    ),
  ),
});

/**
 * A connector or scheduled prompt tool call, by name only. Its arguments,
 * result, error and approval can hold data from the user's apps, so the
 * snapshot keeps none of them.
 */
const vSharedToolPart = v.object({
  type: v.string(),
  toolCallId: v.string(),
});

export const vSharedMessage = v.object({
  role: v.union(v.literal("user"), v.literal("assistant")),
  // The turn's order in the thread. A prompt and its reply share it.
  order: v.number(),
  text: v.string(),
  parts: v.array(
    v.union(
      vSharedTextPart,
      vSharedFilePart,
      vSharedWebSearchPart,
      vSharedToolPart,
    ),
  ),
});

export type SharedMessage = Infer<typeof vSharedMessage>;
type SharedPart = SharedMessage["parts"][number];

/**
 * The message as a shared snapshot keeps it, or null when nothing of it is
 * kept. A prompt keeps its text and attachments. A reply keeps its text,
 * its web searches, and the names of its connector and scheduled prompt
 * tool calls. It drops every other field, such as IDs, metadata, status
 * and errors.
 */
export function redactMessage(message: UIMessage): SharedMessage | null {
  if (message.role !== "user" && message.role !== "assistant") return null;
  const parts = message.parts.flatMap((part): SharedPart[] =>
    message.role === "user" ? promptPart(part) : replyPart(part),
  );
  // A tool part's `type` is any string, so `type` can't narrow to text.
  const texts = parts.flatMap((part) => ("text" in part ? [part.text] : []));
  // Like replyText in the client, a reply's steps get a blank line between.
  const text = message.role === "user" ? message.text : texts.join("\n\n");
  if (!text && texts.length === parts.length) return null;
  return { role: message.role, order: message.order, text, parts };
}

type Part = UIMessage["parts"][number];

function promptPart(part: Part): SharedPart[] {
  if (part.type === "text") return [{ type: "text", text: part.text }];
  if (part.type === "file") {
    return [
      {
        type: "file",
        mediaType: part.mediaType,
        url: part.url,
        ...(part.filename !== undefined && { filename: part.filename }),
      },
    ];
  }
  return [];
}

function replyPart(part: Part): SharedPart[] {
  if (part.type === "text") {
    return part.text ? [{ type: "text", text: part.text }] : [];
  }
  if (!part.type.startsWith("tool-")) return [];
  // The UI message doesn't know the tools' types, so this reads the fields
  // every tool part has.
  const call = part as unknown as {
    type: `tool-${string}`;
    toolCallId: string;
    state: string;
    input?: unknown;
    output?: unknown;
  };
  if (call.type === "tool-webSearch") return [webSearchPart(call)];
  const toolName = call.type.slice("tool-".length);
  if (findConnectorTool(toolName) || findA8Tool(toolName)) {
    return [{ type: call.type, toolCallId: call.toolCallId }];
  }
  return [];
}

function webSearchPart(call: {
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
}): SharedPart {
  const query = isRecord(call.input) ? call.input.query : undefined;
  const results =
    call.state === "output-available" && Array.isArray(call.output)
      ? call.output.filter(isRecord).flatMap((result) =>
          typeof result.url === "string"
            ? [
                {
                  title: typeof result.title === "string" ? result.title : "",
                  url: result.url,
                  snippet:
                    typeof result.snippet === "string" ? result.snippet : "",
                  ...(typeof result.publishedDate === "string" && {
                    publishedDate: result.publishedDate,
                  }),
                },
              ]
            : [],
        )
      : undefined;
  return {
    type: "tool-webSearch",
    toolCallId: call.toolCallId,
    // A search that failed or never finished keeps its state, not its error.
    state: call.state,
    ...(typeof query === "string" && { input: { query } }),
    ...(results && { output: results }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
