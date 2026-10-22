# Auth defense in depth research

Research date 2026-10-22. Versions checked: next 16.3.6, react 19.2.8, better-auth 1.6.33 (installed; `package.json` says `~1.6.15`), @convex-dev/better-auth 0.12.5, convex 1.46.0, server-only 0.0.1. Next.js docs are cited from the copy shipped in `node_modules/next/dist/docs` (matches 16.3.6), with the nextjs.org URL. Latency figures marked "measured" come from `docs/performance/research.md`. Everything else is an estimate and says so.

Decision, 2026-10-22: use only what Next.js, Better Auth and @convex-dev/better-auth document. An earlier draft recommended verifying the `convex_jwt` signature in Next with `jose`. It was implemented and then removed, because none of the three documents it. Pages stay static with no server auth check.

Implemented from this research:

- `src/proxy.ts` checks `getSessionCookie` before `isAuthenticated()` on auth pages, so anonymous visitors cost no Convex call (summary item 3).
- `startCheckout` in `src/app/(marketing)/actions.ts` returns early when there is no session cookie (item 4).
- `src/lib/auth-server.ts` starts with `import "server-only"`, and the `server-only` package is a dependency (item 5).

State of the working tree before those changes:

- `src/proxy.ts` redirects app routes to `/sign-in` when `getSessionCookie` finds no session cookie. On `/sign-in`, `/sign-up` and `/forgot-password` it calls `isAuthenticated()` and redirects signed-in users to `/chat`.
- `src/app/(chat)/layout.tsx` reads no cookies and fetches no token. All `(chat)` pages are prerendered shells. `c/[threadId]` uses `generateStaticParams() { return [] }`, so each thread path renders once on first visit and is cached.
- `requireSignedIn()` and `requireSignedOut()` were deleted from `src/lib/auth-server.ts`. No page or layout checks auth on the server.
- `src/lib/auth-server.ts` turns on `jwtCache` with `expirationToleranceSeconds: 0`.
- `next.config.ts` sets `experimental.staleTimes.dynamic = 300` and no security headers.

## Summary

| # | Technique | Expected impact | Effort | Risk |
|---|---|---|---|---|
| 1 | Keep Convex functions as the security boundary. The audit below found no public query, mutation or action missing an auth or ownership check. | This is where all user data is read and written, so it is the check that protects data. Already paid for. | None | None |
| 2 | Add no server auth check to the static `(chat)` shells. Server code that later reads user data gets it through `fetchAuthQuery` or `preloadAuthQuery`, so Convex checks the session on that read. | Keeps the prerendered HTML and instant navigation. A check on a page that renders no user data protects nothing. | None | Low. Server code that reads data any other way would be unprotected. |
| 3 | Done. In `proxy.ts`, check `getSessionCookie` before `isAuthenticated()` on auth pages. | Anonymous visitors to `/sign-in` stop paying a Convex roundtrip in the proxy. Measured after the change: 28 ms for an anonymous `/sign-in` on `next start`. The token call measured about 0.8s for a signed-in user. | S | Low |
| 4 | Done. Return early from `startCheckout` when there is no session cookie. | Stops anonymous POSTs from costing a token fetch plus a Convex action call. Security is unchanged, since Convex already refuses them. | S | None |
| 5 | Done. Add `import "server-only"` to `src/lib/auth-server.ts`. | A client import becomes a build error. | S | None |
| 6 | Static security headers in `next.config.ts`: HSTS, `frame-ancestors`/`X-Frame-Options`, `nosniff`, `Referrer-Policy`, and a CSP without nonces. | Adds clickjacking and downgrade protection with no render cost. | S-M | Medium for the CSP. A missing `connect-src` entry breaks Convex or Deepgram sockets. |
| 7 | Upgrade next to 16.3.8 and raise the better-auth floor to `~1.6.22`. | Hygiene. None of the open advisories applies to this app on inspection. | S | Low |
| 8 | Decide on the revocation window. Actions authenticate by JWT only, and the JWT lives 15 minutes. | A revoked session can call `dictation.token`, `billing.checkout` and `billing.portal` for up to 15 minutes. | S | Low-medium. Shorter JWTs mean more token fetches. |
| 9 | Long term only: `cacheComponents`, with the page check inside `<Suspense>`. | The only way to have a server page check and a prerendered shell together. | L | High. See research.md item 12. |

Items 3, 4 and 5 are done. Items 6 to 9 are open.

## 1. What Next.js says about proxy, layouts and the DAL

Proxy is optional and optimistic:

- Next splits authorization into optimistic checks, which read the session from the cookie, and secure checks, which compare it with the database. It recommends a Data Access Layer for both, and Proxy "optionally" for optimistic checks. `node_modules/next/dist/docs/01-app/02-guides/authentication.md:1013-1024` (https://nextjs.org/docs/app/guides/authentication#authorization).
- Proxy runs on every matched route, prefetches included, so it should "only read the session from the cookie" and avoid database checks. `authentication.md:1033`.
- "While Proxy can be useful for initial checks, it should not be your only line of defense in protecting your data. The majority of security checks should be performed as close as possible to your data source." `authentication.md:1121`.
- For static routes that share data between users, the docs say the DAL can't help because the data is fetched at build time, and to "Use Proxy to protect static routes." `authentication.md:1231`. The `(chat)` shells are this case, with the difference that they carry no protected data at all.

The DAL:

- A DAL is a `server-only` module with a `verifySession()` wrapped in React `cache()`, so it runs once per render pass. It returns the user id or redirects. Call it "in your data requests, Server Actions, Route Handlers". `authentication.md:1131-1175`.
- The Data Security guide says a DAL should run only on the server, perform authorization checks and return minimal DTOs. `node_modules/next/dist/docs/01-app/02-guides/data-security.md:56-66` (https://nextjs.org/docs/app/guides/data-security#data-access-layer).
- In this app the DAL already exists, in Convex. Next reads user data only through `fetchAuthQuery`, `fetchAuthMutation`, `fetchAuthAction` and `preloadAuthQuery` from `src/lib/auth-server.ts`. The @convex-dev/better-auth Next.js guide documents these as the helpers "for authenticated SSR, server functions, and route handlers", and Convex checks the session inside each function they call. https://labs.convex.dev/better-auth/framework-guides/next

What Better Auth says for Next.js (https://www.better-auth.com/docs/integrations/next):

- "In Next.js proxy/middleware, it's recommended to only check for the existence of a session cookie", using `getSessionCookie(request)`. That is what `src/proxy.ts` does.
- "We recommend handling auth checks in each page/route", with `auth.api.getSession({ headers })` in a server component. With Convex, the auth server runs in Convex, so the matching helper in Next is `isAuthenticated()` from `convexBetterAuthNextJs`. `main` had this as `requireSignedIn()`/`requireSignedOut()`. It was removed for speed, and the decision above keeps it out (see sections 2 and 8).

Layouts and pages:

- Layouts "don't re-render on navigation, meaning the user session won't be checked on every route change." A layout also can't stop child segments from rendering or appearing in the RSC payload. `authentication.md:1350-1356`.
- A top-level `await` on cookies or the DAL in a layout delays the first streamed chunk and holds `{children}`. Move it into a nested component under `<Suspense>`. `authentication.md:1362-1366`.
- Returning `null` from a layout when unauthorized is "not recommended" because nested segments and Server Actions are separate entry points. `authentication.md:1458-1459`.

Server Actions and Route Handlers:

- Treat both like public API endpoints and verify the user inside each one. `authentication.md:1461-1463, 1501-1503`.
- An exported Server Action is reachable by direct POST even when no UI imports it. Encrypted action ids reduce the risk "in cases where an authentication layer is missing", but you should still verify inside each action. `data-security.md:279-291`.
- "A page-level authentication check does not extend to the Server Actions defined within it." `data-security.md:339`.
- Server Functions are POSTs to the route that uses them, so "a Proxy matcher that excludes a path will also skip Server Function calls on that path", and a refactor "can silently remove Proxy coverage." `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:249-251` (https://nextjs.org/docs/app/api-reference/file-conventions/proxy). In this app the actions are used on `/`, which the matcher doesn't include, so the proxy never covers them.

The concrete reason, CVE-2025-29927:

- GHSA-f82v-jwr5-mffw, critical, published 2025-03-21: "It is possible to bypass authorization checks within a Next.js application, if the authorization check occurs in middleware." The workaround was to drop external requests carrying the `x-middleware-subrequest` header. Fixed in 15.2.3, 14.2.25, 13.5.9 and 12.3.5. https://github.com/advisories/GHSA-f82v-jwr5-mffw
- 16.3.6 is outside every affected range. The lesson still holds. One header was enough to skip middleware entirely, and every app that relied on middleware alone exposed whatever was behind it.

## 2. Does a check on a static shell add security?

What the shell contains:

- `(chat)/layout.tsx` and the pages read no cookies, headers or user data, so their HTML and RSC payload are identical for every visitor. Next prerenders a route automatically when no dynamic APIs are used. `node_modules/next/dist/docs/01-app/02-guides/self-hosting.md:287`.
- `c/[threadId]` renders each path on first visit and caches it. `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-static-params.md:290-296`. The only per-path value is the thread id from the URL.
- The JS chunks under `/_next/static` are not in the proxy matcher (`src/proxy.ts` `config.matcher`), so anyone can download the app code today without a cookie. Those chunks name the Convex functions the client calls and inline `NEXT_PUBLIC_CONVEX_URL`.
- Convex public functions are "exposed to the public Internet" whatever Next does. `convex/_generated/ai/guidelines.md:88`. "Public functions can be called by anyone, including potentially malicious attackers." https://docs.convex.dev/understanding/best-practices/#use-some-form-of-access-control-for-all-public-functions

What an attacker gains by getting past the proxy:

- The shell UI and skeletons, which hold nothing user-specific, and the bundle, which is already public.
- Getting past the proxy doesn't need a bug. `getSessionCookie` returns any non-empty cookie value without validating it (`node_modules/better-auth/dist/cookies/index.mjs:211-220`), so a request with `Cookie: better-auth.session_token=x` passes. Better Auth's docs say the same: "THIS IS NOT SECURE!" and "`getSessionCookie` only checks for the existence of a session cookie; it does not validate it." https://www.better-auth.com/docs/integrations/next
- Once the shell loads, every Convex query runs with no valid token and returns empty or null (`convex/lib/guards.ts:1-4, 26-29, 54-58`). `SessionGuard` then sends the browser to `/sign-in`.
- One side effect is not about data. Each new `/c/<anything>` path writes an entry to the Next server cache, which self-hosted Next keeps in memory (50 MB by default) and on disk. `self-hosting.md:89, 109`. A forged cookie lets anyone mint entries. A server page check wouldn't help here, because reading cookies would remove the caching altogether. The size of this risk is not measured.

Verdict: on these shells a server check changes the experience of someone holding a stale or forged cookie. They would get a redirect instead of an empty shell followed by a client redirect. It protects no data. The boundary that protects data is the Convex functions, plus the two server actions and the auth route handler, which all end up in Convex.

## 3. Fast server checks and what they cost

| Check | What it proves | Network | Cost |
|---|---|---|---|
| `getSessionCookie(request)` | A cookie named `better-auth.session_token` exists | None | String parse. About 0 (estimate). |
| `isAuthenticated()` with `jwtCache`, fresh cookie | A `convex_jwt` cookie exists and its `exp` claim is in the future. The signature is not checked. | None | Base64 decode. About 0 (estimate). |
| `isAuthenticated()` with `jwtCache`, no cookie or expired | The session is valid in Convex | One HTTP call to Convex | About 0.8s (measured, signed-in). |
| `isAuthenticated()` without `jwtCache` | The session is valid in Convex | One HTTP call every time | About 0.8s (measured). |
| Better Auth session lookup | The session row exists and has not expired | One HTTP call to Convex, where the sessions live | Similar to the token call (estimate). |

`getSessionCookie`:

- Reads `__Secure-better-auth.session_token` or `better-auth.session_token` and returns the raw value. `node_modules/better-auth/dist/cookies/index.mjs:211-220`. It accepts the unprefixed name in production too, so the prefix gives no protection here.

`convexBetterAuthNextJs`:

- `getToken` and `isAuthenticated` share a request-scoped `React.cache`. `node_modules/@convex-dev/better-auth/dist/nextjs/index.js:5-9, 62-69, 86-94`.
- With `jwtCache.enabled`, `getToken` reads the `convex_jwt` cookie and checks its expiry with `jose.decodeJwt`, which does not verify the signature. `node_modules/@convex-dev/better-auth/dist/utils/index.js:58-74`. So `isAuthenticated()` is an optimistic check today, and a forged cookie with a future `exp` passes it. Any reintroduced `requireSignedIn()` built on it would not be a secure check.
- With no cookie, or an expired one, it calls `${CONVEX_SITE_URL}/api/auth/convex/token`. `utils/index.js:43-57, 62-64`. The proxy used to call `isAuthenticated()` on auth pages for every visitor, so an anonymous visitor with no cookies triggered this call before the static sign-in page was served. The proxy now checks `getSessionCookie` first, which skips it.
- `fetchAuth*` retries once with a fresh token when a call with the cached token fails with a non-auth error. `nextjs/index.js:70-84`.

The JWT itself:

- Signed RS256 for this config (`node_modules/@convex-dev/better-auth/dist/auth-config.js:33-43`), issuer `CONVEX_SITE_URL`, audience `convex`, lifetime 900 s by default, with `sessionId` in the payload. `node_modules/@convex-dev/better-auth/dist/plugins/convex/index.js:44, 55-64`.
- The cookie uses Better Auth's cookie defaults: `httpOnly`, `sameSite: "lax"`, and `secure` with the `__Secure-` prefix when the base URL is https. `node_modules/better-auth/dist/cookies/index.mjs:21, 32-35`.
- The public keys are served at `/api/auth/convex/jwks` (`plugins/convex/index.js:49, 243`). The `JWKS` env var holds the private key and must stay in Convex (README "Static JWKS" section).
- Verifying this signature in Next would need custom code with `jose`, which none of the three frameworks documents. It was tried and removed (see the decision at the top). Convex verifies the signature on every function call.

Better Auth `cookieCache`:

- Stores the session in a short-lived signed cookie so `getSession` skips the database. Its default `maxAge` is 300 s (`cookies/index.mjs:48`). Revoked sessions "may remain active on other devices until the cookie cache expires." https://www.better-auth.com/docs/concepts/session-management
- `getCookieCache` verifies an HMAC with `BETTER_AUTH_SECRET` (`cookies/index.mjs:221-246`). That secret lives only in the Convex env today. Using it in Next would copy the secret into a second place.

Streaming the check without losing the static shell:

- Without Cache Components, reading `cookies()` anywhere in a route "opts the whole route into dynamic rendering." `node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md:685` and `production-checklist.md:47`. A `<Suspense>` boundary then only lets the response stream. The HTML is no longer prerendered, and each soft navigation to an uncached page makes a server request. For reference, the thread page as a dynamic route without auth work committed in 0.43 to 0.84s (measured, dev). A prefetched static page with `loading.tsx` commits at click in production.
- With Cache Components, a cookie read inside `<Suspense>` does not make the route dynamic. The rest prerenders into the static shell and the boundary streams. `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md:317`, `02-guides/authentication-with-cache-components.md:18, 117`. A `use cache: private` session read is cached in the browser with the default 5-minute `stale`. `authentication-with-cache-components.md:292-296`.
- `redirect()` in streamed content becomes a client-side meta redirect, because the status code has already been sent. `03-api-reference/04-functions/redirect.md:12`.
- Under Cache Components, `generateStaticParams` must return at least one param or the build fails. `generate-static-params.md:310`. The thread page returns `[]` today.

Interaction with `staleTimes`:

- `staleTimes.dynamic` covers pages that are neither static nor fully prefetched. `static`, which defaults to 5 minutes, covers static pages. Neither changes partial rendering, so shared layouts are never refetched on navigation. `03-api-reference/05-config/01-next-config-js/staleTimes.md:25-35`.
- So a page-level server check runs on the first visit and then at most once per 300 s per page on soft navigation. A layout check runs on hard loads only. Neither is continuous. Continuous enforcement comes from Convex checking every query and mutation, and `SessionGuard` acting on `useConvexAuth()`.

## 4. Convex authorization and audit

Canonical pattern:

- Every public function that serves signed-in features should check `ctx.auth.getUserIdentity()`, and access control should use the identity or an unguessable argument, never a spoofable one like an email. https://docs.convex.dev/understanding/best-practices/#use-some-form-of-access-control-for-all-public-functions
- Only schedule and `ctx.run*` internal functions. Same page, "Only schedule and ctx.run* internal functions".
- "NEVER accept a `userId` or any user identifier as a function argument for authorization purposes." `convex/_generated/ai/guidelines.md:214`. Component functions are not exposed to clients, so do auth in the app function before calling into a component. `guidelines.md:318`.
- @convex-dev/better-auth: `authComponent.getAuthUser(ctx)` gets the user "with session validation". `ctx.auth.getUserIdentity()` reads the JWT, and the docs note "this does not validate the session." https://github.com/get-convex/better-auth/blob/main/docs/content/docs/basic-usage/authorization.mdx
- `safeGetAuthUser` looks up the session by the JWT's `sessionId` with `expiresAt > now`, then the user. `node_modules/@convex-dev/better-auth/dist/client/create-client.js:35-69`. So a revoked session fails at once in any function that uses it.

This repo's guards (`convex/lib/guards.ts`):

- `requireUser`/`optionalUser` use `safeGetAuthUser` and check the session (lines 20-29). `requireIdentity`/`requireIdentityEmail` use the JWT only, for actions (lines 35-51).
- `getOwnThread`, `authorizeThreadAccess` and `findOwnThread` compare the Agent thread's `userId` with the signed-in user (lines 54-85).
- No `ctx.runQuery`, `ctx.runMutation`, `ctx.runAction` or `ctx.scheduler` call in `convex/` targets an `api.*` function. All target `internal.*` or components.
- No public function takes a `userId` argument.

Public functions audited: 57 functions plus 1 HTTP action.

| File | Functions | Check |
|---|---|---|
| `threads.ts` | `list`, `listPinned`, `search` | `optionalUser`. Lists read by the user's id. `search` reads title and message matches scoped to `userId`, then `findOwnThread` for message-only hits. |
| `threads.ts` | `get` | `getOwnThread` |
| `threads.ts` | `rename`, `setArchived`, `setPinned`, `remove` | `authorizeThreadAccess` |
| `chat/messages.ts` | `listThreadMessages` | `getOwnThread`. Also drops deltas from streams outside the thread (lines 69-76). |
| `chat/queue.ts` | `getQueue` | `getOwnThread` |
| `chat/queue.ts` | `editQueuedPrompt`, `deleteQueuedPrompt` | `getOwnQueuedPrompt`, which runs `requireUser` and `findOwnThread` on the row's thread (lines 116-129) |
| `chat/send.ts` | `startThread` | `requireUser`. Attachments must have a row with the user's id (`attachments/load.ts:52-56`). |
| `chat/send.ts` | `sendMessage`, `resumeQueue`, `regenerateReply`, `editPrompt` | `authorizeThreadAccess` |
| `chat/stop.ts` | `stopReply` | `authorizeThreadAccess` |
| `chat/approval.ts` | `decideAction` | `authorizeThreadAccess` |
| `attachments/upload.ts` | `generateUploadUrl` | `requireUser` |
| `attachments/upload.ts` | `registerUpload` | `requireIdentity`, then `claimUpload` runs `requireUser` and checks the grant belongs to the user |
| `auth.ts` | `getCurrentUser` | `safeGetAuthUser` |
| `autoApprove.ts` | `setAutoApprove` | `authorizeThreadAccess` |
| `autoApprove.ts` | `hasSeenWarning`, `markWarningSeen` | `optionalUser` / `requireUser` |
| `billing.ts` | `plan`, `latestCredits` | `optionalUser` |
| `billing.ts` | `checkout`, `portal` | `requireIdentityEmail` / `requireIdentity` |
| `billing.ts` | `enabled` | None. Returns a deployment flag. |
| `connectors.ts` | `list` | `optionalUser` |
| `connectors.ts` | `connect` | `internal.signIns.checkConnectStart` runs `requireUser` before any outbound fetch |
| `connectors.ts` | `finishConnect` | `internal.signIns.takePendingConnect` runs `requireUser` and returns the row only if it is the user's |
| `connectors.ts` | `disconnect` | `internal.connections.getConnection` with `connectorId` runs `requireUser` (`connections.ts:76-81`) |
| `connectors.ts` | `callback` (HTTP action) | None. Redirects to `/connectors` and saves nothing, except deleting a pending sign-in on a vendor `error` |
| `dictation.ts` | `token` | `requireIdentity` |
| `dictation.ts` | `available` | None. Returns a deployment flag. |
| `models.ts` | `defaultModel`, `setDefaultModel` | `optionalUser` / `requireUser` |
| `models.ts` | `setThreadModel`, `dismissModelSwitch` | `authorizeThreadAccess` |
| `pendingActions.ts` | `listMine` | `optionalUser`, rows by user id, `findOwnThread` per row |
| `scheduledPrompts.ts` | `list`, `unreadCount` | `optionalUser` |
| `scheduledPrompts.ts` | `markRead` | `requireUser` and `row.userId === user._id` |
| `scheduledPrompts.ts` | `create` | `requireUser` |
| `scheduledPrompts.ts` | `update`, `pause`, `resume`, `remove`, `runNow` | `requireOwnScheduledPrompt` (lines 850-857) |
| `sharedSnapshots.ts` | `share`, `unshare` | `authorizeThreadAccess` |
| `sharedSnapshots.ts` | `getShareStatus` | `getOwnThread` |
| `sharedSnapshots.ts` | `getSharedSnapshot`, `listSharedMessages` | None, by design. A link holds a 128-bit random `publicId` (lines 493-494). |

Result: no public function is missing an auth or ownership check. Lower-severity notes:

1. `convex/signIns.ts:86-88`. `takePendingConnect` deletes the pending row before it compares `userId`. A different signed-in user holding the `state` value could cancel someone else's sign-in in progress. They can't finish it. The state is 32 random bytes (`convex/lib/connectorAuth.ts:105`), so this only matters if the state leaks. Moving the delete after the ownership check closes it.
2. `convex/connectors.ts:239-255`. The HTTP callback deletes the pending sign-in for any request with `state` and `error`, with no session. Same exposure as note 1. The code comment says this is deliberate.
3. JWT-only actions: `dictation.token` (`convex/dictation.ts:41`), `billing.checkout` (`convex/billing.ts:71`) and `billing.portal` (`convex/billing.ts:93`). They see a revoked session only when its JWT expires, up to 15 minutes. If that matters, have them run `requireUser` through an internal query first. That adds one function call each.
4. `guidelines.md:213` prefers `identity.tokenIdentifier` over `identity.subject` for ownership. This app has one issuer, and `subject` is the Better Auth user id, so using `subject` is safe here. It would need revisiting if a second auth provider were added.

## 5. Server actions and route handlers in `src/`

`grep "use server"` finds one file, and there is one `route.ts`.

| Entry point | Auth check | Verdict |
|---|---|---|
| `src/app/(marketing)/actions.ts:22` `getVisitor` | Session cookie presence, then `fetchAuthQuery(api.billing.plan)`. Convex `optionalUser` validates the session. | OK. Returns only the caller's own plan. A forged cookie gets `{ signedIn: true, plan: null }`, which only changes landing-page UI. |
| `src/app/(marketing)/actions.ts:40` `startCheckout` | Session cookie presence (added), then `fetchAuthAction(api.billing.checkout)`, where Convex `requireIdentityEmail` throws when signed out. | OK. Before the change, an anonymous POST cost a token fetch (no `convex_jwt` cookie, `utils/index.js:62-64`) plus a refused Convex action. It now returns "Sign in to upgrade." first, as `getVisitor` does. |
| `src/app/api/auth/[...all]/route.ts:3` | Forwards to Better Auth in Convex (`nextjs/index.js:26-56`). Better Auth does its own session, origin and rate-limit checks. | OK |
| `src/proxy.ts` | `isAuthenticated()` on auth pages, now only when a session cookie exists | Fixed. Before the change, anonymous visitors triggered a Convex call. |

Server Actions also get an Origin-vs-Host check from Next. `data-security.md:546-550`. No `serverActions.allowedOrigins` is needed for a single domain.

## 6. Other hardening with a primary source

`server-only`:

- Mark session code with `import "server-only"` so a client import fails the build. `data-security.md:243-255`, `authentication.md:566`. `src/lib/auth-server.ts` has no secrets today, since it reads only `NEXT_PUBLIC_*`. The import still stops the Better Auth handler and server helpers from being pulled into a client bundle by mistake. Done, with the `server-only` package the docs link to.

Better Auth config (`convex/auth.ts`), checked against the security reference https://www.better-auth.com/docs/reference/security:

- `trustedOrigins` is `SITE_URL` plus `TRUSTED_ORIGINS` (`convex/auth.ts:43`). Better Auth blocks requests from other origins and uses the same list for callback URLs.
- Rate limiting is on with database storage and stricter rules for sign-in, sign-up, password reset and verification email. A per-email sign-in limit runs in a `before` hook. Better Auth reads the client IP from `X-Forwarded-For` by default and says to enable trusted proxy headers only "if you trust the proxy headers reaching your application." The Next handler copies all incoming headers to Convex (`nextjs/index.js:29`), so the IP it sees depends on the host overwriting `X-Forwarded-For`. The per-email limit does not depend on it.
- Cookies use the defaults `httpOnly`, `sameSite: "lax"`, and `secure` on https (`cookies/index.mjs:21, 32-35`). Make sure `SITE_URL` is https in production so the `__Secure-` prefix applies.
- Sessions last 7 days (`cookies/index.mjs:47`) and refresh daily. `freshAge` defaults to 1 day and gates endpoints that require a fresh session. https://www.better-auth.com/docs/concepts/session-management. `revokeSessionsOnPasswordReset` is on, and `cookieCache` is off, which keeps revocation immediate for every function that uses `safeGetAuthUser`.
- The JWT lifetime is the revocation window for actions and for `jwtCache` checks: 900 s (`plugins/convex/index.js:44`), set with `jwt.expirationSeconds`.
- `encryptOAuthTokens: true` and `accountLinking: { enabled: false }` are already set.

Security headers in `next.config.ts`:

- A CSP set in `headers()` without nonces keeps pages static. `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md:417-450` (https://nextjs.org/docs/app/guides/content-security-policy#without-nonces).
- Nonce-based CSP requires dynamic rendering of every page, disables static optimization and ISR, and is incompatible with PPR. `content-security-policy.md:38, 181, 391-397`. It would undo the static shells.
- Subresource Integrity (experimental `sri`) is a hash-based alternative that keeps static generation. `content-security-policy.md:456-482`.
- `Strict-Transport-Security`, `X-Frame-Options`, `Permissions-Policy`, `X-Content-Type-Options` and `Referrer-Policy` examples: `03-api-reference/05-config/01-next-config-js/headers.md:523-582` (https://nextjs.org/docs/app/api-reference/config/next-config-js/headers).
- `next.config.js` headers apply first in the routing order, before Proxy. `proxy.md:240-242`. They add no render work.
- The CSP `connect-src` needs the Convex `https://` and `wss://` origins, Deepgram's socket and anything else the browser calls. Inventory these before turning it on, or ship it as `Content-Security-Policy-Report-Only` first.

Dependency advisories, from `gh api advisories?affects=...`:

- next 16.3.6 is affected by six advisories fixed in 16.3.8: GHSA-cjq9-62q9-8jv4, GHSA-mcj8-r9mp-w47p, GHSA-4jqv-mc3x-m676, GHSA-f87g-xv8r-7p7x, GHSA-3w37-wq28-93x7 and GHSA-39w2-rjm5-chcv. On inspection none applies. `next.config.ts` has no `images.remotePatterns` (needed for the image SSRF). There is no root catch-all page (the App Router cache poisoning) and no Pages Router (the self-hosted SSG one). There are no metadata image routes beyond static icons, no Draft Mode, and the MCP issue is dev-only. Upgrade anyway.
- better-auth GHSA-qq9h-g4jm-xgf3 (pre-account hijacking on magic-link and email-OTP sign-in) is fixed in 1.6.22. Installed is 1.6.33, and the app uses neither plugin. `package.json` still allows 1.6.15, so raise the range floor.

## 7. Not recommended / traps

- Treating `isAuthenticated()` with `jwtCache` as a secure check. It decodes the JWT without verifying it (`utils/index.js:66-73`).
- A server check in `(chat)/layout.tsx`. It doesn't rerun on soft navigation, doesn't stop child segments from rendering (`authentication.md:1352-1354`), and makes every page in the group dynamic.
- A cookie read in each `(chat)` page without Cache Components. It makes each route dynamic, drops the prerendered HTML and the on-demand thread cache, and protects no data.
- Turning on Better Auth `cookieCache` for speed. `jwtCache` already removed the token call, and `cookieCache` delays revocation by up to `maxAge`.
- Custom JWT verification in Next with `jose` against `/api/auth/convex/jwks`. It works (it was built and tested here), but none of the frameworks documents it, and it adds code to maintain for a check that protects no data on static shells. Removed by decision.
- Copying the `JWKS` env var into Next. It holds the private key.
- Nonce-based CSP. See section 6.
- Relying on the proxy matcher for Server Actions. The actions run on `/`, outside the matcher (`proxy.md:249-251`).

## 8. Recommended architecture

Ranked by how much protection each layer gives, with expected latency.

1. Convex functions are the authorization boundary. Every public query and mutation uses a guard from `convex/lib/guards.ts`. Queries return empty when signed out, mutations throw, and thread-scoped functions check ownership. Cost: two component sub-queries per function run for the session and user lookup. They are already paid, and research.md item 9 covers that trade-off. Optional: have the three JWT-only actions check the session through an internal query, which adds one function call each (estimate, not measured).

2. Server Actions and Route Handlers check inside, close to the data. Both server actions end in a Convex call through `fetchAuth*`, and Convex checks the session. `startCheckout` returns early with no session cookie (done). A new action that touches data calls Convex through `fetchAuth*` and never reads data another way. Cost: about 0 for the early return.

3. Proxy stays the optimistic redirect layer Better Auth documents. App routes need a session cookie (`getSessionCookie`). Auth pages redirect to `/chat` only when a session cookie exists and `isAuthenticated()` agrees (done). Cost: about 0 for anonymous visitors. A signed-in visitor to an auth page costs a Convex call only when the `convex_jwt` cookie is missing or expired. Otherwise `jwtCache` decodes the cookie locally.

4. Pages and the `(chat)` layout stay static with no server auth check (decided). They render no user data, so a check has nothing to protect, and adding one makes the route dynamic. That cost about 0.43 to 0.84s per uncached navigation as a dynamic route (measured, dev), against an instant commit for a prefetched static page. If a page later renders user data on the server, it fetches it with `preloadAuthQuery` or `fetchAuthQuery` inside `<Suspense>`, and Convex checks the session on that read.

5. `SessionGuard` stays as UX. It redirects once `useConvexAuth()` reports signed out. It has no security role.

6. Headers and hygiene: static security headers and a no-nonce CSP in `next.config.ts`, next 16.3.8, better-auth `~1.6.22`. `import "server-only"` on `auth-server.ts` is done. Cost: none at render time.

7. Later, as its own project: Cache Components with an `isAuthenticated()` check inside `<Suspense>` in each page. This is the only way to get a page-level server check that streams behind a prerendered shell. It needs `generateStaticParams` to return at least one param and the restructuring described in research.md item 12.
