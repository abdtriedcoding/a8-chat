# Apps run through the vendor's MCP server, with a8 as the OAuth and MCP client

a8 connects to each app's own hosted MCP server. a8 runs the OAuth sign-in itself and stores each user's tokens encrypted. When a reply needs an app, the reply action opens an `@ai-sdk/mcp` client to that server, turns its tools into AI SDK tools, and closes the client when the reply ends. An aggregator would have been faster to start with, but a8 is open source, and self-hosters shouldn't need a paid third party that holds their users' tokens. Anthropic's API can call MCP servers directly through `mcp_servers`, but tools then run on Anthropic's side with no approval step, so a8 couldn't pause an action for the user. It also only works on Claude, and Stage 9 opens a8 to every model.

Both the sign-in and the reply-time connection use `@ai-sdk/mcp`'s `auth()` with one OAuth provider backed by Convex tables. `auth()` handles PKCE, the `resource` parameter, dynamic client registration and pre-registered clients, and it refreshes on a 401. It checks `state` and `iss` only when the provider stores `state` and the callback passes `iss`, so a8's provider does both. So a8 doesn't write those protocol steps itself, and it doesn't use better-auth for app tokens, because better-auth's generic OAuth plugin can't register clients dynamically or send `resource`.

## Considered options

- **Aggregator (Composio, Pipedream Connect, Arcade):** hundreds of apps on day one, but priced per call or per user, and the vendor holds every token.
- **Anthropic `mcp_servers`:** no OAuth client code to write, but it has no approval hook and is Claude only.
- **a8-built tools on each app's REST API:** full control, but a8 would write and maintain every tool. This stays the fallback for apps whose vendor MCP server a8 can't use.
- **Official `@modelcontextprotocol/sdk` for auth:** it supports client ID metadata documents, which `@ai-sdk/mcp` doesn't. Not needed while Notion accepts dynamic registration.

## Consequences

- Each connector says how it signs in. Notion lets any client register itself, and a8 registers once per deployment, not once per user, because Notion says re-registering orphans earlier grants. GitHub doesn't allow self-registration, so a8 uses its own GitHub App, and a self-hosted a8 without those keys shows GitHub as unavailable.
- A GitHub App's user token only reaches accounts where the app is installed, and GitHub Apps skip organisation app policies. So connecting GitHub can take a second step: installing a8's app on the user's account or organisation, where an owner approves the install. GitHub recommends a GitHub App for its MCP server. An OAuth App would need one consent screen and no install, but its `repo` scope reaches every private repo the user can see.
- Each connector pins its MCP server's and authorization server's origins. The provider's `validateAuthorizationServerURL` rejects any other authorization server, and a `fetch` wrapper refuses other hosts, because that hook doesn't see the endpoints inside the server's metadata. Together they block SSRF through metadata.
- Notion and GitHub both rotate refresh tokens, and Notion can revoke the whole connection if a rotated-away token is reused. A mutation can't make network requests, so refresh uses a lease. A mutation claims the refresh, the action fetches the new token, and a second mutation commits it only if the version still matches. Other replies wait and re-read.
- Slack only allows MCP for Marketplace-listed apps, and Google's Drive and Gmail MCP servers are in a gated preview (October 2026). Both wait, and Gmail is the first candidate for an a8-built connector.
- The MCP auth spec (2026-07-28) prefers client ID metadata documents and deprecates dynamic client registration. Revisit if Notion drops dynamic registration.
