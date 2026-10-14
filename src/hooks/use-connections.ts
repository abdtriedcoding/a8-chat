import { useAuthQuery } from "@/hooks/use-auth-query";
import { api } from "../../convex/_generated/api";
import type { ConnectorStatus } from "../../convex/connectors";

/**
 * The user's connection status for each catalog connector, in catalog
 * order, or undefined while it loads.
 */
export function useConnections(): ConnectorStatus[] | undefined {
  return useAuthQuery(api.connectors.list);
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
