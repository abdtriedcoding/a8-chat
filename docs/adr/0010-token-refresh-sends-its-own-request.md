# Token refresh sends its own request

a8 refreshes a connection's tokens with one POST to the token endpoint stored with the OAuth client registration: `grant_type=refresh_token`, the refresh token, the registration's credentials, and the `resource` the sign-in sent. It reads `error` from the JSON body of a failed answer, and keeps the old refresh token when the answer has none (RFC 6749 section 6). This replaces ADR 0003's rule for refresh only. Connect and finish connect still use `@ai-sdk/mcp`'s `auth()`.

Each `auth()` call ran protected resource discovery, authorization server discovery and a registration lookup before the refresh POST, so a refresh cost 3 or 4 HTTP calls. `auth()` was also built to sign in, not to refresh, and a8 worked around that. Its refresh provider handed `auth()` a token with an empty access token, overrode `invalidateCredentials` so a refused refresh token wasn't sent twice, and read the token endpoint's `error` in a `fetch` wrapper, because `auth()` swallows some refresh errors and goes on to build a sign-in URL. The SDK doesn't export its refresh function. A refresh is one step that RFC 6749 specifies fully, and a8 already sends its own revocation request, so writing it is less code than the workarounds.

## Considered options

- **Keep `auth()` for refresh:** no protocol code in a8, but 2 or 3 extra requests per refresh, and the workarounds break when the SDK changes how it handles a refused refresh.
- **Call the SDK's `refreshAuthorization`:** the request a8 wants, but the package doesn't export it.

## Consequences

- A refresh makes one HTTP call. It doesn't rediscover the authorization server, so a vendor that moves its token endpoint breaks refresh. `auth()` already refuses to sign in when the stored token endpoint doesn't match the vendor's metadata, so both work again once a8 forgets the client registration.
- The connection stores the `resource` that `auth()` sent with the code exchange, and a refresh sends it again. `auth()` takes it from the protected resource metadata, which can name a different URL than the MCP server's, so a8 stores what was sent instead of deriving it. Connections from before a8 stored it refresh without `resource`, which RFC 8707 reads as the resource of the original grant.
- Refresh and revocation authenticate as the OAuth client registration the same way: HTTP Basic when it has a secret, else `client_id` in the body. `auth()` picks the same when the vendor lists `client_secret_basic`. Of the catalog connectors (October 2026), only Calendly doesn't, and it lists only `none`, so it gets `client_id` in the body as long as its registration came back without a secret. A vendor that issues a secret but doesn't accept HTTP Basic would need a8 to store the auth method its registration returned.
- An OAuth client registration stored without its token endpoint can't refresh. Only rows from before a8 stored it lack one, `auth()` couldn't refresh those either, and sign-in never adds it. So a refresh forgets such a registration and marks the connection as needing a reconnect, and the next sign-in registers again.
- `invalid_grant` marks the connection as needing a reconnect, and `invalid_client` or `unauthorized_client` also forgets the OAuth client registration. Any other error leaves the tokens and the status as they were.
