// The catalog of connectors. Each one is a folder here holding a manifest
// and a logo. The Apps page, and later the composer and the reply runner,
// read this list, so they can't disagree about what a8 can connect to.
import { notion } from "./notion/manifest";

export type ConnectorManifest = {
  /** The word typed after @, and the connector's id. Lowercase. */
  handle: string;
  name: string;
  /** One line for the Apps page. */
  description: string;
  /** A vendor's own MCP server, or tools built into a8 (Stage 4). */
  kind: "vendorMcp" | "builtIn";
  /** The MCP server's Streamable HTTP URL, from the vendor's docs. */
  serverUrl: string;
  /**
   * How the user signs in. "oauth" is MCP authorization with dynamic client
   * registration and PKCE, the only kind so far.
   */
  signIn: "oauth";
  /** What the user grants, in plain words, shown before they sign in. */
  access: string[];
  /** The OAuth scopes to ask for. Unset means the server's own default. */
  scopes?: string[];
  /**
   * Whether the maintainer tested this server. Only a checked server's
   * tools can count as reads.
   */
  checked: boolean;
};

export const connectors: readonly ConnectorManifest[] = [notion];

export function getConnector(handle: string): ConnectorManifest | undefined {
  return connectors.find((connector) => connector.handle === handle);
}
