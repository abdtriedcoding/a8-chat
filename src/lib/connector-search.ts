import type { ConnectorView } from "../../convex/lib/connectorView";

/**
 * The connectors whose name or handle contains the search, in the order
 * given. Case, surrounding spaces and a leading @ don't matter, so `@no`
 * finds Notion. The Connectors page's search box and the composer's @ menu
 * both filter with it.
 */
export function searchConnectors<
  Connector extends Pick<ConnectorView, "name" | "handle">,
>(connectors: readonly Connector[], search: string): Connector[] {
  const query = search.trim().replace(/^@/, "").toLowerCase();
  return connectors.filter(
    ({ name, handle }) =>
      name.toLowerCase().includes(query) ||
      handle.toLowerCase().includes(query),
  );
}
