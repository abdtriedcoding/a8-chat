# Adding a catalog connector

A catalog connector is an entry in `CONNECTORS` in `convex/lib/connectors.ts`. a8 reaches the app through the vendor's own MCP server (ADR 0003). Write each entry from what the vendor's server reports, and check it with the probe below.

## The probe

`scripts/probe-connector.ts` asks a vendor's MCP server what a catalog entry needs. It's a dev helper. Nothing in the app runs it.

```bash
bun run probe <mcp-url>            # a server that isn't in the catalog yet
bun run probe <connector-id>       # a catalog connector, like notion
```

Without a token, it prints:

- the result of an `initialize` request sent with no token, and the server's `WWW-Authenticate` challenge if it refuses
- the protected resource metadata (RFC 9728), with each URL it tried
- the authorization server metadata (RFC 8414 or OpenID Connect discovery), with each URL it tried
- the registration endpoint, if there is one
- whether the server accepts client ID metadata documents
- the token endpoint auth methods, PKCE methods and grant types
- the scopes named in the challenge, the resource metadata and the authorization server metadata
- every origin it reached or found in the metadata, with what uses each one

To list tools from a server that needs sign-in, it needs an access token. There are two ways to give it one:

```bash
bun run probe linear --sign-in                             # sign in through the browser
read -rs MCP_TOKEN && export MCP_TOKEN && bun run probe linear   # paste a token you already have
```

`--sign-in` registers a new client named "a8 probe" with the vendor on each run, prints the authorize URL and waits on `http://localhost:8976/callback` for you to approve. It needs a registration endpoint. `--scope <scope>` sets the scope it asks for.

`read -rs` keeps the token out of the command text. `--token <token>` and `MCP_TOKEN=<token> bun run probe ...` also work, but your shell history keeps the token.

With a token, or when `initialize` works without one, it prints every tool with its annotations, its description length and its input schema size, then the tool count and the size of all definitions together. For a catalog connector, each allowlisted tool also shows its `kind`, `read` or `action`.

### Checking a catalog connector

Given a connector ID, the probe ends with a catalog check against the live server. It checks the same things a8 does when it signs in and calls tools:

- a `dynamicRegistration` connector's server has a registration endpoint
- the MCP URL's origin is in `pinnedOrigins`
- the probe found authorization server metadata, and each authorization server's origin is in `pinnedOrigins`
- every origin a8's server contacts is pinned. The check skips the authorization endpoint, because only the browser opens it.
- no two allowlisted tools get the same model tool name
- every tool in `toolAllowlist` is on the server's live tool list
- an account label tool, if the entry names one, is an allowlisted `read` and is on the server's live tool list

Each failed check prints a `FAIL` line, and the script exits with code 1. A vendor that renames a tool shows up as an allowlisted tool missing from the server. The allowlist check needs a tool list, so a run without a token fails it too.

## What a8 does with the entry

The model's name for each tool is `<connector id>__<tool>`, like `notion__search`. a8 drops a prefix of the connector ID on the vendor's name, rewrites any character outside `[a-zA-Z0-9_-]` to `_`, and cuts a name over 64 characters short. A rewritten or cut name ends in a hash of the vendor's name, so two names stay different. Old threads find their rows by this name, so never change a connector's ID.

Before a8 stores a server's tool list on a connection, it cuts each description to 2,048 characters, turns each input schema into an object schema with no `anyOf`, `oneOf` or `allOf` at the top, and keeps at most 100 tools and 500 KB, allowlisted tools first.

Each reply estimates the size of every connector tool it would offer, at 4 characters of JSON a token. At 35k tokens or under, every tool loads. Above that, the thread defers connector tools from then on (ADR 0006). The first 3 mentioned connectors load, and every other connector tool is sent with Anthropic's `deferLoading` and a description that starts with the connector's name in brackets, like `[Linear]`. The model finds those with the `toolSearch` tool. On a model without tool search, only the mentioned connectors load. Each reply logs a `reply tools` line with whether the thread defers, the loading mode, the estimate, each search's query and found tools, the tools called and connector errors.

A long allowlist, or a vendor with long descriptions, moves users past the budget sooner. Keep allowlists short.

## Checklist for a new connector

1. Run the probe on the vendor's MCP URL. Record the URL, every origin, whether there's a registration endpoint, the scopes, the tools and their annotations.
2. Do a real registration with a8's redirect URI before writing code. The probe's `--sign-in` uses a localhost redirect URI, so it doesn't prove the vendor accepts a8's.
3. Write the catalog entry: the MCP URL, pinned origins, sign-in kind, allowlist with a `kind` on each tool, and account label source. `pinnedOrigins` lists every origin the probe's catalog check needs: the MCP server's, and each authorization server, token or registration host the sign-in uses. The account label comes from a field of the token response, like Notion's `workspace_name`, or from a tool a8 calls once after sign-in, with a dot path to the label in its result. a8 calls that tool without asking, so it must be a `read` on the allowlist.
4. Pick the allowlist from the probe's tool list. Take the reads and the common actions, about 10 tools and never more than 15. Set each tool's `kind` to `read` or `action` by what it does, not by its annotations. A read only fetches. Anything that writes, sends or deletes is an action. The `kind` decides whether the tool asks for approval, and the server's `readOnlyHint: false` can only make a read ask too (ADR 0008).
5. Add the logo under `public/connectors/`.
6. Run the probe on the new connector's ID with `--sign-in`. Every check should print `ok`.
7. Run the browser checks with the `browser-verify` skill and put the screenshots on the PR.
