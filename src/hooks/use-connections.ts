import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { ConnectorStatus } from "../../convex/connectors";

/**
 * The user's connection status for each catalog connector, in catalog
 * order, or undefined while it loads. It waits for the session to load
 * first. Before then the query sees no user and would report every
 * connector as disconnected.
 */
export function useConnections(): ConnectorStatus[] | undefined {
  const { isLoading } = useConvexAuth();
  return useQuery(api.connectors.list, isLoading ? "skip" : {});
}

/**
 * Whether the user has a connection to the connector, counting one that
 * needs reconnecting. Undefined, while the connections load, counts as not
 * connected.
 */
export function isConnected(
  connection: Pick<ConnectorStatus, "status"> | undefined,
): boolean {
  return connection !== undefined && connection.status !== "disconnected";
}
