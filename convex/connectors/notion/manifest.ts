import type { ConnectorManifest } from "../registry";

// https://developers.notion.com/docs/get-started-with-mcp
export const notion: ConnectorManifest = {
  handle: "notion",
  name: "Notion",
  description: "Search, read and write pages and databases.",
  kind: "vendorMcp",
  serverUrl: "https://mcp.notion.com/mcp",
  signIn: "oauth",
  access: [
    "Read pages and databases you can open in the workspace you pick",
    "Create and edit pages and databases in that workspace",
  ],
  checked: true,
};
