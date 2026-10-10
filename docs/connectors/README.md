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

To list tools, it needs an access token. There are two ways to get one:

```bash
bun run probe linear --sign-in            # sign in through the browser
MCP_TOKEN=<token> bun run probe linear    # a token you already have
```

`--sign-in` registers a new client named "a8 probe" with the vendor on each run, prints the authorize URL and waits on `http://localhost:8976/callback` for you to approve. It needs a registration endpoint. `--scope <scope>` sets the scope it asks for. `--token <token>` works in place of `MCP_TOKEN`, but leaves the token in your shell history.

With a token, or when `initialize` works without one, it prints every tool with its annotations, its description length and its input schema size, then the tool count and the size of all definitions together.

### Checking a catalog connector

Given a connector ID, the probe ends with a catalog check against the live server. It checks the same things a8 does when it signs in and calls tools:

- a `dynamicRegistration` connector's server has a registration endpoint
- the MCP URL's origin is `pinnedOrigins.mcpServer`
- the probe found authorization server metadata, and each authorization server's origin is `pinnedOrigins.authorizationServer`
- every origin a8's server contacts is pinned. The check skips the authorization endpoint, because only the browser opens it.
- every tool in `toolAllowlist` is on the server's live tool list

Each failed check prints a `FAIL` line, and the script exits with code 1. A vendor that renames a tool shows up as an allowlisted tool missing from the server. The allowlist check needs a tool list, so a run without a token fails it too.

## Checklist for a new connector

1. Run the probe on the vendor's MCP URL. Record the URL, every origin, whether there's a registration endpoint, the scopes, the tools and their annotations.
2. Do a real registration with a8's redirect URI before writing code. The probe's `--sign-in` uses a localhost redirect URI, so it doesn't prove the vendor accepts a8's.
3. Write the catalog entry: the MCP URL, pinned origins, sign-in kind, allowlist and account label field.
4. Pick the allowlist from the probe's tool list. Take the reads and the common actions, about 10 tools and never more than 15.
5. Add the logo under `public/connectors/`.
6. Run the probe on the new connector's ID with `--sign-in`. Every check should print `ok`.
7. Run the browser checks with the `browser-verify` skill and put the screenshots on the PR.
