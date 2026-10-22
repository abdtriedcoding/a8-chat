import type { StreamArgs, SyncStreamsReturnValue } from "@convex-dev/agent";
import {
  type UIMessage,
  type UIMessagesQuery,
  useStreamingUIMessages,
} from "@convex-dev/agent/react";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import {
  type BetterOmit,
  type ErrorMessage,
  type Expand,
  pick,
} from "convex-helpers";
import { usePaginatedQuery } from "convex-helpers/react/cache/hooks";
import type { PaginatedQueryArgs, UsePaginatedQueryResult } from "convex/react";
import type { FunctionArgs, FunctionReference } from "convex/server";
import { useMemo } from "react";

// Copied from @convex-dev/agent 0.7.3 (src/vercel/react/useUIMessages.ts,
// with the helpers it imports from UIMessages.ts and shared.ts, which the
// package doesn't export). The change: the message pages come from the
// cached usePaginatedQuery, so a thread's first page stays subscribed after
// the thread view unmounts. It needs customPagination to page the agent's
// merged stream without gaps. Streams stay on the agent's uncached hook.
// Compare with the agent's file when upgrading it.

type UIStatus = UIMessage["status"];

type UIMessageLike = {
  order: number;
  stepOrder: number;
  status: UIStatus;
  parts: UIMessage["parts"];
  role: UIMessage["role"];
};

type StreamQuery<Args = Record<string, unknown>> = FunctionReference<
  "query",
  "public",
  { threadId: string; streamArgs?: StreamArgs } & Args,
  { streams: SyncStreamsReturnValue }
>;

type UIMessagesQueryArgs<
  Query extends UIMessagesQuery<unknown, UIMessageLike>,
> =
  Query extends UIMessagesQuery<unknown, UIMessageLike>
    ? Expand<BetterOmit<FunctionArgs<Query>, "paginationOpts" | "streamArgs">>
    : never;

type UIMessagesQueryResult<
  Query extends UIMessagesQuery<unknown, UIMessageLike>,
> = Query extends UIMessagesQuery<unknown, infer M> ? M : never;

/**
 * The agent's useUIMessages, with the message pages kept in the query cache.
 * Same arguments and result.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useUIMessages<Query extends UIMessagesQuery<any, any>>(
  query: Query,
  args: UIMessagesQueryArgs<Query> | "skip",
  options: {
    initialNumItems: number;
    stream?: Query extends StreamQuery
      ? boolean
      : ErrorMessage<"To enable streaming, your query must take in streamArgs: vStreamArgs and return a streams object returned from syncStreams. See docs.">;
    skipStreamIds?: string[];
  },
): UsePaginatedQueryResult<UIMessagesQueryResult<Query>> {
  // The agent paginates a merged stream of messages, which only stays gapless
  // when each page's end is pinned on loadMore. customPagination does that.
  const paginated = usePaginatedQuery(
    query,
    args as PaginatedQueryArgs<Query> | "skip",
    { initialNumItems: options.initialNumItems, customPagination: true },
  );

  const startOrder = paginated.results.length
    ? Math.min(...paginated.results.map((m) => m.order))
    : 0;
  // These are streaming messages that will not include full messages.
  const streamMessages = useStreamingUIMessages(
    query as StreamQuery<UIMessagesQueryArgs<Query>>,
    !options.stream ||
      args === "skip" ||
      paginated.status === "LoadingFirstPage"
      ? "skip"
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ ...args, paginationOpts: { cursor: null, numItems: 0 } } as any),
    { startOrder, skipStreamIds: options.skipStreamIds },
  );

  const merged = useMemo(() => {
    return {
      ...paginated,
      results: mergeUIMessages(
        paginated.results,
        (streamMessages ?? []) as UIMessagesQueryResult<Query>[],
      ),
    };
  }, [paginated, streamMessages]);

  return merged as UsePaginatedQueryResult<UIMessagesQueryResult<Query>>;
}

function mergeUIMessages<M extends UIMessageLike>(
  messages: M[],
  streamMessages: M[],
): M[] {
  const deduped = dedupeMessages(messages, streamMessages);
  // Messages may have been split by pagination. Re-combine them here
  // after dedupe has had access to each message's original stepOrder.
  return combineUIMessages(deduped as unknown as UIMessage[]) as unknown as M[];
}

function dedupeMessages<
  M extends {
    order: number;
    stepOrder: number;
    status: UIStatus;
  },
>(messages: M[], streamMessages: M[]): M[] {
  return sorted(messages.concat(streamMessages)).reduce((msgs, msg) => {
    const last = msgs.at(-1);
    if (!last) {
      return [msg];
    }
    if (last.order !== msg.order || last.stepOrder !== msg.stepOrder) {
      return [...msgs, msg];
    }
    if (
      (last.status === "pending" || last.status === "streaming") &&
      msg.status !== "pending"
    ) {
      // Let's prefer a streaming or finalized message over a pending
      // one.
      return [...msgs.slice(0, -1), msg];
    }
    // skip the new one if the previous one (listed) was finalized
    return msgs;
  }, [] as M[]);
}

function sorted<T extends { order: number; stepOrder: number }>(
  messages: T[],
): T[] {
  return [...messages].sort(
    (a, b) => a.order - b.order || a.stepOrder - b.stepOrder,
  );
}

function combineUIMessages(messages: UIMessage[]): UIMessage[] {
  return messages.reduce((acc, message) => {
    if (!acc.length) {
      return [message];
    }
    const previous = acc.at(-1)!;
    if (
      message.order !== previous.order ||
      previous.role !== message.role ||
      message.role !== "assistant"
    ) {
      acc.push(message);
      return acc;
    }
    // We will replace it with a combined message
    acc.pop();
    const newParts = [...previous.parts];
    for (const part of message.parts) {
      const toolCallId = getToolCallId(part);
      if (!toolCallId) {
        newParts.push(part);
        continue;
      }
      const previousPartIndex = newParts.findIndex(
        (p) => getToolCallId(p) === toolCallId,
      );
      if (previousPartIndex === -1) {
        // Tool call not found in previous parts, add it as new
        newParts.push(part);
        continue;
      }
      const previousPart = newParts.splice(previousPartIndex, 1)[0];
      newParts.push(mergeParts(previousPart, part));
    }
    acc.push({
      ...previous,
      ...pick(message, ["status", "metadata", "agentName"]),
      parts: newParts,
      text: joinText(newParts),
    });
    return acc;
  }, [] as UIMessage[]);
}

function getToolCallId(
  part: UIMessage["parts"][number] & { toolCallId?: string },
) {
  return part.toolCallId;
}

function mergeParts(
  previousPart: UIMessage["parts"][number],
  part: UIMessage["parts"][number],
): UIMessage["parts"][number] {
  const merged: Record<string, unknown> = { ...previousPart };
  for (const [key, value] of Object.entries(part)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged as ToolUIPart | DynamicToolUIPart;
}

function joinText(parts: UIMessage["parts"]) {
  return parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { text: string }> =>
        part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .filter(Boolean)
    .join(" ");
}
