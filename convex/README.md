# convex/

This folder is a8's backend. Before writing Convex code, read `_generated/ai/guidelines.md`. For the connector modules in depth, see [`docs/connectors/README.md`](../docs/connectors/README.md).

## Modules

### Setup

- `convex.config.ts`: the app's components (Better Auth, Agent, rate limiter, Resend, Polar) and every env var the backend reads. The root [`README.md`](../README.md) explains each one.
- `schema.ts`: a8's own tables. Threads, messages and users live in the Agent and Better Auth components.
- `auth.config.ts`: tells Convex to trust Better Auth's tokens, with the public keys inline when `JWKS` is set.
- `http.ts`: the HTTP routes, Better Auth's, the connector OAuth callback, the shared page's files and, when billing is on, Polar's webhooks.
- `crons.ts`: the cleanup jobs. Attachments that were never sent, expired upload grants and orphaned storage go daily, and expired connector sign-ins, idle temporary threads and emails older than a day go hourly.

### Accounts

- `auth.ts`: Better Auth's options, `getCurrentUser`, `getLatestJwks`, which returns the signing key for the `JWKS` env var, and `purgeAccount`, which deletes a user's data when they delete their account.
- `emails.ts`: queues verification, password reset and scheduled run emails through Resend, and deletes each one a day later.
- `billing.ts`: the Billing page's plan and credits queries, Pro checkout and Polar's customer portal, the action that cancels a deleted user's subscription, and the one that deletes their Polar customer.
- `usage.ts`: the cost recorder, and the lookup of each model call's cost on AI Gateway. It adds each usage event's cost to the day's spend and, in credits, to the user's credit period.
- `rateLimits.ts`: the rate limits on sends, web searches, attachments, wrong passwords at email sign-in, connector sign-ins, connector tool calls, shares and new scheduled prompts. Web searches also have a daily cap across all users. On the hosted a8, a send also needs credits left and the day's spend under the daily ceiling (`checkSpend`). Self-hosted a8 has no credits, so its sends keep daily caps per user and across all users.

### Chat

- `agents/chat.ts`: the Agent and the native tools.
- `models.ts`: the model picker's functions, which set a thread's model and the user's default model.
- `chat/send.ts`: the four Sends, which are `startThread`, `sendMessage`, `editPrompt` and `regenerateReply`, plus starting and resuming the queue. `sendMessage` queues its prompt while the thread is busy.
- `chat/reply.ts`: `streamReply`, which writes a reply, and the reply's start and failure. `expireReply` fails a reply whose runner Convex stopped at its time limit.
- `chat/stop.ts`: stopping a reply, and the text a stopped reply keeps.
- `chat/queue.ts`: a thread's queued prompts and its paused flag, and editing and deleting them.
- `chat/approval.ts`: the user's decision on an action card, and when a reply continues.
- `chat/turns.ts`: reads a thread's turns, such as its last turn and the turn a continuing reply picks up.
- `chat/messages.ts`: `listThreadMessages`, the thread's messages for the UI.
- `threads.ts`: listing, getting, searching, renaming and deleting threads.
- `sharedSnapshots.ts`: sharing a thread through a public link (ADR 0011). It copies the thread's finished turns in batches, unshares, and serves the public page's queries and its attachments, which load only while the link is live.
- `titles.ts`: a new thread's title, written by Claude Haiku from its first prompt at no credit cost.
- `tools/webSearch.ts`: the web search tool, and the only code that calls Tavily (ADR 0001).
- `tools/findTools.ts`: a8's own tool search, which finds deferred connector tools on models other than Claude (ADR 0016).

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
- `lib/credits.ts`: the credit ledger, and `currentCreditRow`, which opens a new period on the first usage in it or after an upgrade.
- `lib/creditPeriod.ts`: which ledger row covers now, shared with the Billing page.
- `lib/usage.ts`: sends reply steps, titles and web searches to the cost recorder. A model call costs what AI Gateway reports for it. `trackModelCalls` follows a reply's model calls, so a step the user stopped costs what the gateway reports too.
- `lib/models.ts`: the model list, with each model's lab, gateway id, attachments, plans and rough credits per reply. Shared with the picker.
- `lib/gateway.ts`: the AI Gateway client, and the language model for a model on the list.
- `lib/threadModels.ts`: each thread's model and each user's default model, and the plan check on each send. A send whose thread model left the list or isn't on the user's plan replies on the default model and moves the thread to it.
- `lib/guards.ts`: session and ownership checks. See the rules below.
- `lib/errors.ts`: the error codes and `appError`. See the rules below.
- `lib/prompt.ts`: prompt and title checks, and the prompt message the model gets.
- `lib/queue.ts`: the queue's size cap and how long a reply has to start, shared with the client.
- `lib/attachments.ts`: attachment limits, accepted file types and rejection reasons.
- `lib/instructions.ts`: the system prompt, and its connector part.
- `lib/replyFailure.ts`: the reason a failed reply shows.
- `lib/timeZone.ts`: the browser's time zone, which a reply uses for the user's date.
- `lib/sharedMessages.ts`: what a shared snapshot keeps of a message, and the redaction that drops the rest.
- `lib/sharedFiles.ts`: the path a shared page loads its attachments from, shared with the client.
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
- `lib/toolLoading.ts`: which connector tools load and which are deferred (ADR 0006, ADR 0009, ADR 0016).
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
