# Google apps run through Google's MCP servers as three connectors, on self-hosted deployments first

Partly built. Google Calendar and Gmail are in the catalog (#111, #112). Google Drive isn't yet (#113). Each consequence below that needs code says whether that code exists.

a8 offers Google as three connectors: Google Drive, Google Calendar and Gmail. Google Drive spans four of Google's MCP servers (Drive, Docs, Sheets and Slides) under one sign-in, because users treat Docs as part of Drive, and "find my Q3 doc and update it" crosses Drive search and a Docs edit. One OAuth client, from the deployment's own Google Cloud project, serves all three. This replaces ADR 0003's plan to wait for Google and build Gmail on its REST API.

## Considered options

- **Six connectors, one per server (as Claude ships them):** more precise, but six toggles and six sign-ins for users who aren't technical.
- **One Google Workspace connector:** one sign-in, but someone who only wants Calendar has to grant Gmail too.
- **a8-built tools on Google's REST APIs:** full control, including sending email, but a8 would write and maintain every tool.

## Consequences

- Google's servers are in the Workspace Developer Preview (October 2026). The project has to be enrolled, and pre-GA terms bar users outside the deployer's organization. So Google works on self-hosted deployments with an Internal consent screen, where restricted Gmail and Drive scopes need neither verification nor a CASA assessment. A public hosted a8 would need Google's permission, verification and CASA.
- A connector can have more than one MCP server, so a catalog entry lists its servers instead of holding one URL. This is built. Each server has a key, and a `toolPrefix` keeps two servers' tool names apart (docs/connectors/README.md).
- Google has no dynamic registration, so a8 signs in with the deployment's own client ID and secret, from `GOOGLE_MCP_CLIENT_ID` and `GOOGLE_MCP_CLIENT_SECRET`. This is built, as the `preRegistered` sign-in. Without both env vars, the connectors show as not set up. The setup guide is `docs/connectors/google.md`.
- Google sends no `scope` in its 401 and gives no refresh token without `access_type=offline` and `prompt=consent`. This is built. A catalog entry's `scopes` and `authorizeParams` go on the authorize URL of every connect and reconnect, and the connection stores the scopes the vendor granted.
- `initialize` and `tools/list` work without a token, so connecting doesn't trigger sign-in; a8 starts it. a8's `connect` already starts sign-in itself, without waiting for a 401.
- Gmail's server has no send tool. a8 exposes reads and `create_draft`, and the user sends the draft from Gmail. This is built.
- Users can untick scopes on Google's consent screen. a8 loads only the tools whose scopes were granted and offers Reconnect. This is built. A catalog entry's `toolScopes` names the scope each tool needs, and the connection stores the scopes Google granted.
