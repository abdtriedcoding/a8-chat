import type { ConnectorStatus } from "../../convex/connectors";

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
