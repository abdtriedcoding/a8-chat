import {
  type OptionalRestArgsOrSkip,
  type PaginatedQueryArgs,
  type PaginatedQueryReference,
  useConvexAuth,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import type { FunctionReference, FunctionReturnType } from "convex/server";

/**
 * `args`, or "skip" until Convex accepts the session token. Until then, and
 * after sign-out, a query sees no user and comes back empty. The
 * `initialToken` from the server render doesn't skip the wait. Convex sets
 * `isAuthenticated` only once the backend confirms the token.
 */
export function useSkipUntilSignedIn<Args>(args: Args | "skip"): Args | "skip" {
  const { isAuthenticated } = useConvexAuth();
  return isAuthenticated ? args : "skip";
}

/** `useQuery` that skips until the user is signed in. */
export function useAuthQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: OptionalRestArgsOrSkip<Query>
): FunctionReturnType<Query> | undefined {
  const authArgs = useSkipUntilSignedIn(args[0] ?? {});
  return useQuery(query, authArgs);
}

/** `usePaginatedQuery` that skips until the user is signed in. */
export function useAuthPaginatedQuery<Query extends PaginatedQueryReference>(
  query: Query,
  args: PaginatedQueryArgs<Query> | "skip",
  options: { initialNumItems: number },
) {
  return usePaginatedQuery(query, useSkipUntilSignedIn(args), options);
}
