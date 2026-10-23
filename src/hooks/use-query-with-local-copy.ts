import { usePaginatedQuery, useQuery } from "convex-helpers/react/cache/hooks";
import {
  type PaginatedQueryArgs,
  type PaginatedQueryItem,
  type PaginatedQueryReference,
  type UsePaginatedQueryResult,
  useConvexAuth,
} from "convex/react";
import {
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
  getFunctionName,
} from "convex/server";
import { useEffect } from "react";
import { saveLocalCopy, useLocalCopy } from "@/lib/local-copy";

/** The local copy's key for a query's value, or a paginated query's first page. */
function queryCopyKey(
  query: FunctionReference<"query">,
  args: Record<string, unknown>,
) {
  return `${getFunctionName(query)}:${JSON.stringify(args)}`;
}

/**
 * The cached useQuery, plus the device's copy of its last value
 * (lib/local-copy) while the live query loads. `stale` is true while `data`
 * is the copy, so nothing should act on it then. A null value isn't copied,
 * and nothing is copied until Convex has confirmed the user's token, so a
 * query answered signed out never overwrites the user's copy.
 */
export function useQueryWithLocalCopy<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query>,
): { data: FunctionReturnType<Query> | undefined; stale: boolean } {
  const live = useQuery(query, args);
  const { isAuthenticated } = useConvexAuth();
  const key = queryCopyKey(query, args);
  const copy = useLocalCopy<FunctionReturnType<Query>>(key);
  useEffect(() => {
    if (isAuthenticated && live !== undefined && live !== null) {
      saveLocalCopy(key, live);
    }
  }, [isAuthenticated, key, live]);
  return live !== undefined
    ? { data: live, stale: false }
    : { data: copy, stale: copy !== undefined };
}

/**
 * The cached usePaginatedQuery, plus the device's copy of its first page
 * while that page loads. `status` stays "LoadingFirstPage" meanwhile, and
 * `stale` is true while `results` is the copy. Like useQueryWithLocalCopy,
 * it copies only once Convex has confirmed the user's token.
 */
export function usePaginatedQueryWithLocalCopy<
  Query extends PaginatedQueryReference,
>(
  query: Query,
  args: PaginatedQueryArgs<Query>,
  { initialNumItems }: { initialNumItems: number },
): UsePaginatedQueryResult<PaginatedQueryItem<Query>> & { stale: boolean } {
  const paginated = usePaginatedQuery(query, args, { initialNumItems });
  const { isAuthenticated } = useConvexAuth();
  const key = queryCopyKey(query, args);
  const copy = useLocalCopy<PaginatedQueryItem<Query>[]>(key);
  const loaded = paginated.status !== "LoadingFirstPage";
  useEffect(() => {
    if (isAuthenticated && loaded) {
      saveLocalCopy(key, paginated.results.slice(0, initialNumItems));
    }
  }, [isAuthenticated, key, loaded, paginated.results, initialNumItems]);
  const stale = !loaded && copy !== undefined;
  return {
    ...paginated,
    results: stale ? copy : paginated.results,
    stale,
  } as UsePaginatedQueryResult<PaginatedQueryItem<Query>> & { stale: boolean };
}
