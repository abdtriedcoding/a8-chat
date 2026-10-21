# convex/

This folder is a8's backend. Before writing Convex code, read `_generated/ai/guidelines.md`. For the connector modules in depth, see [`docs/connectors/README.md`](../docs/connectors/README.md).

## Modules

### Setup

- `convex.config.ts`: the app's components (Better Auth, Agent, rate limiter, Resend, Polar) and every env var the backend reads. The root [`README.md`](../README.md) explains each one.
- `schema.ts`: a8's own tables. Threads, messages and users live in the Agent and Better Auth components.
- `auth.config.ts`: tells Convex to trust Better Auth's tokens.
- `http.ts`: the HTTP routes, Better Auth's, the connector OAuth callback and, when billing is on, Polar's webhooks.
- `crons.ts`: the cleanup jobs. Attachments that were never sent, expired upload grants and orphaned storage go daily, and expired connector sign-ins go hourly.

### Accounts

- `auth.ts`: Better Auth's options, `getCurrentUser`, and `purgeAccount`, which deletes a user's data when they delete their account.
- `emails.ts`: queues verification, password reset and scheduled run emails through Resend.
- `billing.ts`: the Billing page's plan query, Pro checkout and Polar's customer portal, and the action that cancels a deleted user's subscription.
- `rateLimits.ts`: the rate limits on sends, web searches, attachments, email sign-in attempts, connector sign-ins, connector tool calls and shares. Sends and web searches also have a daily cap across all users.

### Chat

- `agents/chat.ts`: the chat model, the Agent and the native tools.
- `chat/send.ts`: the four Sends, which are `startThread`, `sendMessage`, `editPrompt` and `regenerateReply`, plus starting and resuming the queue. `sendMessage` queues its prompt while the thread is busy.
- `chat/reply.ts`: `streamReply`, which writes a reply, and the reply's start and failure.
- `chat/stop.ts`: stopping a reply, and the text a stopped reply keeps.
- `chat/queue.ts`: a thread's queued prompts and its paused flag, and editing and deleting them.
- `chat/approval.ts`: the user's decision on an action card, and when a reply continues.
- `chat/turns.ts`: reads a thread's turns, such as its last turn and the turn a continuing reply picks up.
- `chat/messages.ts`: `listThreadMessages`, the thread's messages for the UI.
- `threads.ts`: listing, getting, searching, renaming and deleting threads.
- `sharedSnapshots.ts`: sharing a thread through a public link (ADR 0011). It copies the thread's finished turns in batches, unshares, and serves the public page's queries.
- `titles.ts`: a new thread's title, written by the model from its first prompt.
- `tools/webSearch.ts`: the web search tool, and the only code that calls Tavily (ADR 0001).

### Attachments

- `attachments/upload.ts`: upload URLs, and registering an uploaded file so a prompt can attach it.
- `attachments/load.ts`: loads a prompt's attachments for the model.
- `attachments/cleanup.ts`: deletes attachments that were never sent, expired upload grants, orphaned storage and a deleted user's attachments.

### Connectors

- `connectors.ts`: the public connector functions `list`, `connect`, `finishConnect` and `disconnect`, and the OAuth callback.
- `connections.ts`: connection rows, the token refresh lease, disconnect and re-encrypting stored secrets.
- `signIns.ts`: connector sign-ins in progress and OAuth client registrations.
- `toolLists.ts`: each connection's stored tool list, and refreshing it.

### `lib/`

These modules hold helpers and register no Convex functions.

- `lib/billing.ts`: whether billing is on, the Polar client, and `getPlan`, the one place that answers which plan a user is on, what it grants a month and the current month's dates.
- `lib/monthlyPeriod.ts`: the date math for a plan's monthly periods, shared with the Billing page.
- `lib/guards.ts`: session and ownership checks. See the rules below.
- `lib/errors.ts`: the error codes and `appError`. See the rules below.
- `lib/prompt.ts`: prompt and title checks, and the prompt message the model gets.
- `lib/queue.ts`: the queue's size cap and how long a reply has to start, shared with the client.
- `lib/attachments.ts`: attachment limits, accepted file types and rejection reasons.
- `lib/instructions.ts`: the system prompt, and its connector part.
- `lib/replyFailure.ts`: the reason a failed reply shows.
- `lib/timeZone.ts`: the browser's time zone, which a reply uses for the user's date.
- `lib/sharedMessages.ts`: what a shared snapshot keeps of a message, and the redaction that drops the rest.
- `lib/threadSearchSnippet.ts`: the snippet thread search shows around a match.
- `lib/authEmails.ts`: the text and HTML of the auth emails.
- `lib/runEmails.ts`: the subject, text and HTML of a scheduled run's emails.
- `lib/connectorView.ts`: the client-safe view of the catalog. It's the only connector module the browser imports.
- `lib/connectors.ts`: the server catalog, with each connector's MCP server URLs, pinned origins and sign-in settings.
- `lib/connectorAuth.ts`: the OAuth provider, the pinned fetch, revocation, OAuth error handling and opening MCP clients.
- `lib/oauthDiscovery.ts`: OAuth metadata discovery, used by revocation and the probe.
- `lib/connectionTokens.ts`: a connection's access token, refreshed under the lease (ADR 0003).
- `lib/encryption.ts`: encrypts and decrypts stored secrets under `CONNECTION_ENCRYPTION_KEY`.
- `lib/connectorToolList.ts`: what a8 keeps of a vendor's tool list, and its token estimate.
- `lib/connectorTools.ts`: a reply's connector tools, the account label tool and reading MCP tool results.
- `lib/toolLoading.ts`: which connector tools load and which are deferred (ADR 0006, ADR 0009).
- `lib/replyTools.ts`: `createReplyTools`, the one call a reply makes for its tools.

## Auth rules (`lib/guards.ts`)

- A query returns empty when signed out, because a session can end under a live query. Use `optionalUser` or `getOwnThread`.
- A mutation or action throws `unauthenticated()` when signed out. Use `requireUser` in a mutation and `requireIdentity` in an action. An action can't read the user table, so `requireIdentity` returns the user ID from the identity's `subject`.
- A mutation on a thread calls `authorizeThreadAccess`. It throws `NOT_FOUND` when the thread isn't the user's, so a wrong ID and someone else's thread look the same.
- Only `lib/guards.ts` and `getCurrentUser` in `auth.ts` read the session.

## Error rules (`lib/errors.ts`)

- `ERROR_CODES` is the one list of codes the backend sends and the UI checks. Add a code there before using it.
- A function the composer calls for a Send or an upload returns a refusal as `{ code, message }`, so the Convex client doesn't log it as an error.
- Every other function throws `appError(code, message)`, a `ConvexError` whose data is `{ code, message }`.
