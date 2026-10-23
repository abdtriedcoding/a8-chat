import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";

type Thread = NonNullable<FunctionReturnType<typeof api.threads.get>>;
type ThreadSummary = FunctionReturnType<typeof api.threads.listPinned>[number];

/** Changes the thread's own query, when it's loaded. */
export function patchThread(
  store: OptimisticLocalStore,
  threadId: string,
  patch: Partial<Thread>,
) {
  const thread = store.getQuery(api.threads.get, { threadId });
  if (thread) {
    store.setQuery(api.threads.get, { threadId }, { ...thread, ...patch });
  }
}

/**
 * Rewrites each loaded page of the chats and archived lists that `include`
 * accepts. Every page when `include` is left out.
 */
export function updateListPages(
  store: OptimisticLocalStore,
  update: (page: ThreadSummary[]) => ThreadSummary[],
  include: (args: FunctionArgs<typeof api.threads.list>) => boolean = () =>
    true,
) {
  for (const { args, value } of store.getAllQueries(api.threads.list)) {
    if (!value || !include(args)) continue;
    store.setQuery(api.threads.list, args, {
      ...value,
      page: update(value.page),
    });
  }
}

/** Rewrites the pinned list, when it's loaded. */
export function updatePinned(
  store: OptimisticLocalStore,
  update: (pins: ThreadSummary[]) => ThreadSummary[],
) {
  const pins = store.getQuery(api.threads.listPinned, {});
  if (pins) store.setQuery(api.threads.listPinned, {}, update(pins));
}

/** Drops the thread from a list. */
export function without(threadId: string) {
  return (threads: ThreadSummary[]) =>
    threads.filter((t) => t._id !== threadId);
}
