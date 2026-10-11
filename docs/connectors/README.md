# Connectors

a8 reaches each app through the vendor's own MCP server, with a8 as the OAuth and MCP client (ADR 0003). This page maps the connector code, explains what a8 does with a catalog entry, and ends with the steps to add a catalog connector.

## Where the code lives

- `convex/connectors.ts`: the public functions, `list`, `connect`, `finishConnect` and `disconnect`, and the OAuth callback route, `/connectors/callback`. `list` returns each catalog connector's status only. The UI takes names and logos from the client-safe view.
- `convex/connectorStore.ts`: every write to connections, sign-ins in progress (`pendingConnects`) and OAuth client registrations (`connectorClients`), the refresh lease mutations, and the revoke-then-delete that disconnect and account deletion share.
- `convex/toolLists.ts`: each connection's stored tool list, in `connectionToolLists`. It fetches, stores and refreshes the list.
- `convex/lib/connectorView.ts`: the client-safe view of the catalog.
- `convex/lib/connectors.ts`: the server catalog.
- `convex/lib/connectorAuth.ts`: the OAuth provider `auth()` signs in with, the pinned fetch, metadata discovery, revocation, the OAuth error classifier, and opening MCP clients.
- `convex/lib/connectionTokens.ts`: a connection's access token, refreshed under the lease (ADR 0003).
- `convex/lib/connectorToolList.ts`: what a8 keeps of a server's tool list, and the token estimate.
- `convex/lib/connectorTools.ts`: a reply's connector tools and the calls they make, the account label tool, and the one reader for MCP tool results.
- `convex/lib/toolLoading.ts`: which tools load and which are deferred (ADR 0006), the history filter for tool search, and the reply's log line.
- `convex/lib/instructions.ts`: the connector part of the system prompt.
- `convex/lib/replyTools.ts`: `createReplyTools`, the one call a reply makes for its connector tools and what goes with them (see "A reply's tools").
- `scripts/probe-connector.ts`: the probe.

In the browser, the Connectors page is `src/app/(chat)/connectors/page.tsx` and `src/components/connectors/`, a reply's tool rows, action cards and Reconnect chips are in `src/components/chat/`, and the composer's mentions are `src/hooks/use-composer-mentions.ts`. They import `convex/lib/connectorView.ts` and types from `convex/connectors.ts`, never `convex/lib/connectors.ts`.

## The catalog

A catalog connector is an entry in two files. Write each entry from what the vendor's server reports, and check it with the probe below.

- `convex/lib/connectorView.ts` holds what the browser shows: the id, name, handle, description, example prompt, card note, and for each MCP server its key, its tool prefix if it has one, each tool's label and each action's target arguments.
- `convex/lib/connectors.ts` holds what only the server needs, under the same id: each server's URL and each tool's kind, the pinned origins, sign-in, scopes, authorize parameters and account label source.

The ids in the view file make up the `ConnectorId` type. The server file keys its entries by those ids, its servers by the view's server keys and its tool kinds by the view's tool names, so a connector, server or tool missing from either file, or a misspelled one, fails the typecheck. So does an account label tool that isn't one of the connector's tools. The typecheck doesn't check the logo file, that a handle is unique, or that a target names a real argument.

A connector with one server, as both files write it:

```ts
// connectorView.ts
{
  id: "notion",
  name: "Notion",
  description: "Search, read and write pages in your Notion workspace.",
  examplePrompt: "@notion find my notes from this week and list the action items",
  servers: {
    notion: {
      tools: {
        "notion-search": { label: "Searching Notion" },
        "notion-update-page": { label: "Updating a Notion page", target: ["page_id"] },
      },
    },
  },
},

// connectors.ts
notion: {
  servers: {
    notion: {
      url: "https://mcp.notion.com/mcp",
      toolKinds: { "notion-search": "read", "notion-update-page": "action" },
    },
  },
  pinnedOrigins: ["https://mcp.notion.com"],
  signIn: { kind: "dynamicRegistration" },
  accountLabel: { from: "tokenResponse", field: "workspace_name" },
},
```

The handle defaults to the id, and the logo is always `public/connectors/<id>.svg`. `dynamicRegistration` is the only sign-in kind. With it, a8 registers itself with the vendor once per deployment.

A connector with several servers lists each one under its own key in both files, like `drive` and `docs`. Sign-in reads the OAuth metadata of the first server in `connectors.ts`, and the token it gets goes to every server. `scopes` sets the scopes sign-in asks for, and `authorizeParams` adds query parameters to the vendor's authorize URL, like `{ access_type: "offline", prompt: "consent" }`. Without `scopes`, sign-in asks for the scopes the first server's protected resource metadata lists. The connection stores the scopes the vendor granted in `grantedScopes`: the token response's `scope`, or the scope the authorize URL asked for when the response has none (RFC 6749, section 5.1). Nothing reads `grantedScopes` yet.

A server key names the server in stored tool lists, so never change it. A connector with one server keys it by the connector id.

### The client-safe view

`connectorView.ts` is the only connector module the browser loads, so it may never name an MCP server URL, a pinned origin, a sign-in or a tool's kind. Besides the card fields and tool labels, it has:

- `findMentions`, which finds the connectors a prompt mentions. The composer and the reply both use it.
- `modelToolName`, the model's name for an MCP tool, and `findConnectorTool`, the connector, label and target behind a model's tool name. A reply's tool rows and action cards use `findConnectorTool`.
- `CONNECT_ERRORS`, the reasons a sign-in can end without connecting. The callback puts one in `?error=`, and `finishConnect` returns one.
- `RECONNECT_ERROR_CODE`, `NEEDS_RECONNECT`. When a connector tool fails because its connection needs reconnecting, its error text starts with this code, and the reply shows a Reconnect chip for that call. Saved replies hold the code, so never change it.

## The probe

`scripts/probe-connector.ts` asks a vendor's MCP server what a catalog entry needs. It's a dev helper. Nothing in the app runs it.

```bash
bun run probe <mcp-url>            # a server that isn't in the catalog yet
bun run probe <connector-id>       # a catalog connector, like notion
```

For a catalog connector with several servers, the metadata comes from the first server, the one sign-in uses. Without a token, it prints:

- the result of an `initialize` request sent with no token, and the server's `WWW-Authenticate` challenge if it refuses
- the protected resource metadata (RFC 9728), with each URL it tried
- the authorization server metadata (RFC 8414 or OpenID Connect discovery), with each URL it tried
- the registration endpoint, if there is one
- whether the server accepts client ID metadata documents
- the token endpoint auth methods, PKCE methods and grant types
- the scopes named in the challenge, the resource metadata and the authorization server metadata
- every origin it reached or found in the metadata, with what uses each one

Metadata discovery is a8's own code from `convex/lib/connectorAuth.ts`, without the pinned origins.

To list tools from a server that needs sign-in, it needs an access token. There are two ways to give it one:

```bash
bun run probe linear --sign-in                             # sign in through the browser
read -rs MCP_TOKEN && export MCP_TOKEN && bun run probe linear   # paste a token you already have
```

`--sign-in` registers a new client named "a8 probe" with the vendor on each run, prints the authorize URL and waits on `http://localhost:8976/callback` for you to approve. It needs a registration endpoint. It asks for the catalog connector's `scopes` and adds its `authorizeParams`, as a8 does. `--scope <scope>` sets the scope it asks for instead.

`read -rs` keeps the token out of the command text. `--token <token>` and `MCP_TOKEN=<token> bun run probe ...` also work, but your shell history keeps the token.

With a token, or when `initialize` works without one, it prints every tool on each server with its annotations, its description length and its input schema size, then the tool count and the size of all definitions together. For a catalog connector, each allowlisted tool also shows its `kind`, `read` or `action`.

### Checking a catalog connector

Given a connector ID, the probe ends with a catalog check against the live server. It checks the same things a8 does when it signs in and calls tools:

- the server has a registration endpoint, which dynamic registration needs
- each server's MCP URL origin is in `pinnedOrigins`
- the probe found authorization server metadata, and each authorization server's origin is in `pinnedOrigins`
- every origin a8's server contacts is pinned. The check skips the authorization endpoint, because only the browser opens it.
- no two allowlisted tools get the same model tool name, across all the connector's servers
- every allowlisted tool is on its server's live tool list
- an account label tool, if the entry names one, is an allowlisted `read` and is on the server's live tool list

Each failed check prints a `FAIL` line, and the script exits with code 1. A vendor that renames a tool shows up as an allowlisted tool missing from the server. The allowlist check needs a tool list, so a run without a token fails it too.

## What a8 does with the entry

### Model tool names

The model's name for each tool is `<connector id>__<tool>`, like `notion__search`. a8 drops the connector ID from the start of the vendor's name when a `-`, `_` or `.` follows it, rewrites any character outside `[a-zA-Z0-9_-]` to `_`, and cuts a name over 64 characters short. A rewritten or cut name ends in a hash of the vendor's name, so two names stay different. Old threads find their rows by this name, so never change a connector's ID. When two of a connector's servers would give tools the same model name, give one of them a `toolPrefix` in the view file. Its tools are then named `<connector id>__<prefix>_<tool>`, and a8 drops the prefix from the vendor's name instead of the connector ID, so `docs.get` on a server with the prefix `docs` becomes `googledrive__docs_get`. A prefix renames its server's tools, so set it when you add the server and don't change it.

### Tool lists

`finishConnect` lists the tools on every server of the connector and stores them with the connection, in the `connectionToolLists` table. a8 stores only the allowlisted tools, and each stored tool names its server by key. Before it stores them, it cuts each description to 2,048 characters, turns each input schema into an object schema with no `anyOf`, `oneOf` or `allOf` at the top, and keeps at most 100 tools and 500 KB. It also estimates the size of their definitions, at 4 characters of JSON a token, so a reply doesn't measure them.

A reply builds its tools from the stored list and sends nothing to the vendor. It asks for a refresh when the list is over a day old or missing, or when the server says it doesn't know a tool, and keeps using the old list meanwhile. A connection with no stored list gets no tools until one is fetched. A refresh is scheduled at most once every 10 minutes per connection, so replies that see the same stale list share one, and a vendor outage doesn't make every reply try again. A refresh whose token the vendor refuses with a 401 refreshes the token and tries once more.

A tool added to the allowlist reaches a connection at its next refresh. A tool removed from it stops being offered at once, but the stored estimate counts it until the next refresh.

### A reply's tools

`streamReply` in `convex/chat.ts` runs one query, `getReplyStart`, for the prompt text, the thread owner's connections and whether the thread defers. It passes them to `createReplyTools`, which returns:

- the tool set: native tools like web search, and the connector tools of every connection that's connected
- the `toolApproval` map, which makes each action wait on an action card
- the loading mode, `all` or `search`
- the connector part of the system prompt, or none for a user with no connections
- a history filter for the Agent's `contextHandler`, which drops tool search references to tools the reply no longer offers (ADR 0006)
- the reply's log
- `close`, which prints the log and closes every MCP client the reply opened

Building the tools sends nothing to the vendors. Each server's MCP client opens on the first call to one of its tools, with the access token refreshed first if it expires within 5 minutes. Each tool call counts against the user's daily connector tool call limit. a8 wraps each result in an `<untrusted-data>` tag and cuts it at about 20 KB.

Each reply adds up the stored estimates of the user's connections. At 35k tokens or under, every tool loads, mentioned connectors first (ADR 0009). Above that, the thread defers connector tools from then on, and the first reply to cross writes a `deferredToolThreads` row (ADR 0006). Up to 3 mentioned connectors still load, and every other connector tool is sent with Anthropic's `deferLoading` and a description that starts with the connector's name in brackets, like `[Linear]`. The model finds those with the `toolSearch` tool.

Each reply logs a `reply tools` line with the number of the user's connections, whether the thread defers, the loading mode, each connector's estimate, the steps, each search's query and found tools, the tools called and connector errors.

A long allowlist, or a vendor with long descriptions, moves users past the budget sooner. Keep allowlists short.

### Approval

A tool runs without asking only when its `kind` is `read` and the server doesn't mark it `readOnlyHint: false`. Every other tool waits on an action card (ADR 0008). A server without an allowlist offers every tool it lists, and each call asks. Custom connectors (#72) will have servers like that. They aren't built yet.

### When a connection stops working

A tool call the vendor refuses with a 401 refreshes the token and runs once more. The connection needs reconnecting when the vendor refuses the refresh, refuses the new token too, or answers 403, when a8 can't decrypt its tokens, or when a tool-list refresh gets the same answers. The call then fails with the `NEEDS_RECONNECT` code, the reply shows a Reconnect chip, and the connection offers no tools until the user reconnects. When the vendor can't be reached for a token refresh, every later call to that connection in the reply fails without trying again.

## Checklist for a new connector

1. Run the probe on each of the vendor's MCP URLs, like `bun run probe https://mcp.example.com/mcp`. Record the URLs, every origin, whether there's a registration endpoint, the scopes, the tools and their annotations. a8 needs a registration endpoint.
2. Check that the vendor accepts a8's redirect URI before writing code. The probe's `--sign-in` uses a localhost redirect URI, so it doesn't prove this. Register a throwaway client by hand with your deployment's redirect URI, `<NEXT_PUBLIC_CONVEX_SITE_URL from .env.local>/connectors/callback`:

   ```bash
   curl -s -X POST <registration endpoint> -H 'Content-Type: application/json' -d '{
     "client_name": "a8 test",
     "redirect_uris": ["https://<deployment>.convex.site/connectors/callback"],
     "grant_types": ["authorization_code", "refresh_token"],
     "response_types": ["code"],
     "token_endpoint_auth_method": "client_secret_basic"
   }'
   ```

   An answer with a `client_id` means the vendor accepts it.
3. Pick the allowlist from the probe's tool list. Take the reads and the common actions, about 10 tools and never more than 15. Set each tool's `kind` to `read` or `action` by what it does, not by its annotations. A read only fetches. Anything that writes, sends or deletes is an action. The `kind` decides whether the tool asks for approval, and the server's `readOnlyHint: false` can only make a read ask too (ADR 0008).
4. Add the view entry to `ENTRIES` in `convex/lib/connectorView.ts`: the id (lowercase letters and digits), name, description, example prompt, a handle only if it differs from the id, a card note if the account needs something first, and under `servers`, for each server, its tools. Key a single server by the connector id. Each allowlisted tool gets a label, and each action whose input schema has top-level arguments that say where it writes, like `page_id`, gets a `target`. The action card shows those under Target and the other arguments under Content. An action without a `target` shows all its arguments under Details. Its place in `ENTRIES` sets its order on the Connectors page.
5. Add the server entry to `ENTRIES` in `convex/lib/connectors.ts` under the same id: under `servers`, each server's URL and a `kind` for each of its tools, then the pinned origins, `signIn: { kind: "dynamicRegistration" }`, scopes and authorize parameters if the vendor needs them, and the account label source. List the server sign-in uses first. `pinnedOrigins` lists every origin the probe's catalog check needs: each MCP server's, and each authorization server, token or registration host the sign-in uses. The account label comes from a field of the token response, like Notion's `workspace_name`, or from a tool a8 calls once after sign-in, with a dot path to the label in its result. a8 calls that tool without asking, so it must be a `read` on the allowlist.
6. Add the logo at `public/connectors/<id>.svg`. The logo sits on a white tile in both themes, so draw it for a light background.
7. Run `bun run typecheck`. It fails on a connector, server or tool that's in one file and not the other.
8. Run the probe on the new connector's ID with `--sign-in`, like `bun run probe example --sign-in`. Every check should print `ok`.
9. Run the browser checks with the `browser-verify` skill: connect, answer a prompt with a read, approve an action card and disconnect. Put the screenshots on the PR.
