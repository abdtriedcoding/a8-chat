# Google apps run through Google's MCP servers as three connectors, on self-hosted deployments first

a8 offers Google as three connectors: Google Drive, Google Calendar and Gmail. Google Drive spans four of Google's MCP servers (Drive, Docs, Sheets and Slides) under one sign-in, because users treat Docs as part of Drive, and "find my Q3 doc and update it" crosses Drive search and a Docs edit. One OAuth client, from the deployment's own Google Cloud project, serves all three. This replaces ADR 0003's plan to wait for Google and build Gmail on its REST API.

## Considered options

- **Six connectors, one per server (as Claude ships them):** more precise, but six toggles and six sign-ins for users who aren't technical.
- **One Google Workspace connector:** one sign-in, but someone who only wants Calendar has to grant Gmail too.
- **a8-built tools on Google's REST APIs:** full control, including sending email, but a8 would write and maintain every tool.

## Consequences

- Google's servers are in the Workspace Developer Preview (October 2026). The project has to be enrolled, and pre-GA terms bar users outside the deployer's organization. So Google works on self-hosted deployments with an Internal consent screen, where restricted Gmail and Drive scopes need neither verification nor a CASA assessment. A public hosted a8 would need Google's permission, verification and CASA.
- A connector can have more than one MCP server, so a catalog entry lists its servers instead of holding one URL.
- Google has no dynamic registration, sends no `scope` in its 401 and gives no refresh token without `access_type=offline` and `prompt=consent`. a8's OAuth provider sets the scopes and both parameters itself on every connect and reconnect, and stores the scopes Google granted on the connection. `initialize` and `tools/list` work without a token, so connecting doesn't trigger sign-in; a8 starts it.
- Gmail's server has no send tool. a8 exposes reads and `create_draft`, and the user sends the draft from Gmail.
- Users can untick scopes on Google's consent screen. a8 loads only the tools whose scopes were granted and offers Reconnect.
