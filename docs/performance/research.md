# Thread switching performance research

Research date 2026-10-22. Versions checked: next 16.3.6, react 19.2.8, convex 1.46.0, convex-helpers 0.1.124, @convex-dev/agent 0.7.3, @convex-dev/better-auth 0.12.5. Next.js docs are cited from the copy shipped in `node_modules/next/dist/docs` (matches 16.3.6), with the nextjs.org URL.

Measured baseline (dev server, switching sidebar threads):

- Click to URL commit (RSC roundtrip): 1.1 to 2.1s.
- URL commit to messages on screen (client Convex queries): 0.65 to 1.1s.
- `/api/auth/convex/token`: about 0.8s per call.
- Without `requireSignedIn()` and `generateMetadata` on the thread page, URL commit took 0.43 to 0.84s.

## Summary

Ranked for this app. Impact numbers come from the measurements above; anything else is an estimate and says so.

| # | Technique | Expected impact | Effort | Risk |
|---|---|---|---|---|
| 1 | Do no auth work in the thread page on soft navigation. Drop `requireSignedIn()` and `generateMetadata` from `c/[threadId]/page.tsx`, and set the tab title from `ThreadView` with a React 19 `<title>`. | URL commit 1.1-2.1s down to 0.43-0.84s (measured, dev). | S | Low. Proxy, layout and every Convex query still check auth. |
| 2 | Turn on `jwtCache` in `src/lib/auth-server.ts`. | Removes the 0.8s token fetch from every server render that still calls `getToken`/`isAuthenticated` (hard loads of the chat layout, `/chat`, auth pages via proxy). | S | Medium. Experimental. A revoked session passes server checks until its JWT expires (15 min default). |
| 3 | Add `loading.tsx` to `c/[threadId]`. | In production the loading state is prefetched, so the click commits at once and shows the skeleton. Removes the "nothing happens" gap. | S | Low. |
| 4 | Keep Convex subscriptions alive with `ConvexQueryCacheProvider`, including a cached `useUIMessages` (`customPagination: true`). | Revisits within 5 min skip the 0.65-1.1s skeleton phase. | M | Low-medium. More open subscriptions, a patched or copied hook. |
| 5 | Start the thread's Convex queries on hover or `onNavigate`, so they run while the RSC request is in flight. | First visits: the client query phase overlaps the URL-commit phase instead of following it. Up to 0.65-1.1s saved when the RSC phase is the longer one (estimate). | S-M | Low. Args must match the hooks exactly. |
| 6 | Set `experimental.staleTimes.dynamic` (for example 300) once the thread page is a pure client shell. | Revisits reuse the cached RSC payload, so the URL commits with no server call. | S | Low-medium. Experimental flag. |
| 7 | Static JWKS for Convex token validation. | Removes two serial HTTP calls from every Convex HTTP-side token validation (server `fetchAuthQuery`, `getToken` path). Not measured. | S | Low. JWKS env var must be refreshed if keys rotate. |
| 8 | Measure with `next build && next start` before and after each change. | Dev numbers include on-demand compilation, unminified React and no prefetching. | S | None. |
| 9 | Cheaper auth inside Convex queries: read the user id from `ctx.auth.getUserIdentity()` instead of `safeGetAuthUser`. | Saves two component sub-queries per query run, which matters for stream deltas every 100ms. Not measured. | M | Medium. Changes session-revocation semantics for reads. |
| 10 | Stop gating thread queries on `useConvexAuth().isAuthenticated`. | Saves one WebSocket roundtrip on hard loads only. | S | Medium. Possible "Chat not found" flash if the token is bad. |
| 11 | Check the client bundle with `next experimental-analyze`. Lazy-load shiki/katex plugins only if they are large and on the critical path. | Unknown until measured. | S to measure | Low. |
| 12 | Long term: `cacheComponents` + `partialPrefetching` (route shells, `<Activity>` route preservation). | Instant navigations by design. | L | High. Layout reads cookies outside Suspense, which is a build error under Cache Components. |

Items 1, 2, 3 and 8 are small and independent. Doing 1 + 3 + 4 + 5 should make a warm thread switch show messages in the same frame as the click (estimate, not measured).

## Recommended architecture

- Server: the `(chat)` layout checks auth once per hard load, using the JWT cookie (`jwtCache`) so it does no network call when the cookie is fresh. Thread pages do no server data work. The thread page returns `<ThreadView threadId>` and nothing else, so its RSC payload is tiny and cacheable.
- Navigation: `<Link>` to `/c/[id]` with a `loading.tsx` skeleton. The router commits at click (prefetched loading state in production). With `staleTimes.dynamic`, revisits skip the server entirely.
- Client data: all thread data comes over the existing Convex WebSocket. `ConvexQueryCacheProvider` sits inside `ConvexBetterAuthProvider` and keeps `threads.get`, `getQueue` and the first messages page subscribed for 5 minutes after unmount. Stream deltas stay uncached (they are short-lived).
- Prefetch: hovering or clicking a sidebar thread subscribes to that thread's queries through the same cache, so by the time `ThreadView` mounts the results are in the client's local store.
- Auth: Convex validates the WebSocket token. Pages keep a cheap cookie-presence check in `proxy.ts`. Convex queries remain the security boundary.

## 1. preloadQuery, usePreloadedQuery and preloadAuthQuery

- `preloadQuery` is `fetchQuery` plus serialization. It awaits the full HTTP query before returning. `node_modules/convex/dist/esm/nextjs/index.js:8-16`.
- `usePreloadedQuery` subscribes with a plain `useQuery` and returns the preloaded value until the live one arrives. `node_modules/convex/dist/esm/react/hydration.js:8-22`.
- `preloadAuthQuery` first gets a token through the request-cached `getToken`, then calls `preloadQuery`. `node_modules/@convex-dev/better-auth/dist/nextjs/index.js:62-70,95-99`. The docs show it with `usePreloadedAuthQuery` in a server component. https://labs.convex.dev/better-auth/framework-guides/next
- `usePreloadedAuthQuery` holds the preloaded value until Convex auth finishes loading. `node_modules/@convex-dev/better-auth/dist/nextjs/client.js:26-36`.
- Convex docs: `preloadQuery` uses `cache: 'no-store'`, so pages using it can't be statically rendered. Two `preloadQuery` calls are not guaranteed to see the same database state, and the docs advise against several on one page. Server rendering support is beta. https://docs.convex.dev/client/nextjs/app-router/server-rendering
- There is no paginated preload. `usePreloadedQuery` wraps `useQuery`, and `useUIMessages` takes no initial data (`node_modules/@convex-dev/agent/dist/vercel/react/useUIMessages.js:71-86`). So the message list, the slow part, can't be preloaded with the stock API. Only `threads.get` could be.
- Trade-off for this app. On a soft navigation the WebSocket is already open and authenticated, so a client query costs one Convex roundtrip. A server preload costs a Next roundtrip, a token fetch (0.8s today) and a Convex HTTP query, all before the RSC payload is ready. Preloading helps only first paint on hard loads.
- Streaming without blocking: an async server component inside `<Suspense>` (or `loading.tsx`) streams in after the shell. Next docs say `loading.tsx` wraps the page in Suspense so the fallback shows while the page renders. `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md:116-140` (https://nextjs.org/docs/app/getting-started/linking-and-navigating). This stops the preload from blocking the URL commit, but the data still arrives later than a warm WebSocket query would deliver it.

Verdict: don't preload on the thread page. If hard-load first paint matters later, preload `threads.get` inside a Suspense boundary only.

## 2. Client query caching

convex/react alone:

- `useQuery` subscribes through `QueriesObserver` and unsubscribes on unmount with no grace period. `node_modules/convex/dist/esm/react/queries_observer.js:110-124`. This is why revisits are as slow as first visits.

convex-helpers `ConvexQueryCacheProvider`:

- Keeps the server subscription open after the last hook unmounts. Default expiration 300000 ms, default `maxIdleEntries` 250. `node_modules/convex-helpers/react/cache/provider.js:26-27`.
- It holds subscriptions through `convex.watchQuery(...).onUpdate(() => {})`. `provider.js:65`. A remounted hook reads the result from the client's local store at once.
- When `maxIdleEntries` is reached, the entry that just went idle is dropped at once. It is not LRU. `provider.js:89`.
- For Next.js, import from `convex-helpers/react/cache/provider` and `convex-helpers/react/cache/hooks`. `node_modules/convex-helpers/README.md:990-1030`.
- README warning: "subscription caching will mean strictly more bandwidth usage". `README.md:972-979`.
- The cached `usePaginatedQuery` uses a fixed pagination id of 0 so the first page is shared across mounts. `node_modules/convex-helpers/react/cache/hooks.js:138-142`.

`@convex-dev/agent` `useUIMessages`:

- Imports `usePaginatedQuery` from `convex-helpers/react` (uncached). `node_modules/@convex-dev/agent/dist/vercel/react/useUIMessages.js:3`. That hook uses `useQueries` from `convex/react`. `node_modules/convex-helpers/react.js:3`.
- The agent component paginates a merged stream (`mergedStream(...).paginate(...)`), `node_modules/@convex-dev/agent/dist/component/messages.js:582`. convex-helpers says stream-based pagination needs `customPagination: true` with the cached hook. `node_modules/convex-helpers/README.md:711-714,802-805`. The cached hook supports the option. `hooks.js:239,345`.
- Stream queries use plain `useQuery` from `convex/react`. `node_modules/@convex-dev/agent/dist/vercel/react/useDeltaStreams.js:3,31,52`. These stay uncached either way. That is fine, since streams are short-lived.
- `mergeUIMessages` is exported from the file but not from `@convex-dev/agent/react`. `node_modules/@convex-dev/agent/dist/react/index.js:1-9`.

Two ways to get a cached `useUIMessages`:

1. `bun patch @convex-dev/agent` to change the import in `useUIMessages.js` to `convex-helpers/react/cache/hooks` and pass `customPagination: true`. The repo already uses `patchedDependencies` (`package.json`). Small diff, but it must be redone on every agent upgrade.
2. Copy `useUIMessages` (about 40 lines plus `dedupeMessages`) into `src/hooks`, using the cached `usePaginatedQuery` and the exported `useStreamingUIMessages`. No patch, but the copy can drift from upstream.

`@convex-dev/react-query` (TanStack):

- Subscriptions stay alive until `gcTime` passes after last use. `staleTime` is `Infinity` because the subscription pushes updates. https://github.com/get-convex/convex-react-query
- Paginated queries are listed as TODO in the README, so it can't back `useUIMessages`. Not installed here. Same source.

Cost of keeping subscriptions: each idle thread holds 3 subscriptions (`threads.get`, `getQueue`, messages page 0). They cost nothing while their data doesn't change. When data changes, Convex reruns the query and pushes the result, which counts as function calls and bandwidth. Convex reruns a query when data it read changes. https://docs.convex.dev/understanding/best-practices/ (section on `Date.now()`).

## 3. Prefetching and navigation

Next.js 16 behavior:

- Automatic prefetching runs only in production. `node_modules/next/dist/docs/01-app/02-guides/prefetching.md:64` (https://nextjs.org/docs/app/guides/prefetching). The dev numbers above include no prefetching at all.
- Without Cache Components, a dynamic page is not prefetched unless it has `loading.js`. With `loading.js`, the layout up to the first loading boundary is prefetched. `prefetching.md:31-36,61-62`.
- Navigating to a dynamic route without `loading.tsx` waits for the server response. Next recommends `loading.tsx` "to enable partial prefetching, trigger immediate navigation". `04-linking-and-navigating.md:169-173`.
- On a soft navigation only the changed segment re-renders. Shared layouts are not refetched. `03-api-reference/05-config/01-next-config-js/staleTimes.md:33-35` (https://nextjs.org/docs/app/api-reference/config/next-config-js/staleTimes). So on thread switches the `(chat)` layout's `getToken()` does not run, but the page's `requireSignedIn()` does, and it pays a full token fetch. The comment in `src/lib/auth-server.ts` ("reuse the request's cached token") is only true on hard loads, where layout and page share one request.
- `staleTimes.dynamic` defaults to 0 (since v15.0.0). Setting it caches dynamic page segments in the client cache. `staleTimes.md:27-31,42-45`.
- `<Link onNavigate>` runs during client-side navigation. `03-api-reference/02-components/link.md:453-455`. It is a good hook to start Convex queries at click time.
- `window.history.pushState` integrates with the router and syncs `usePathname`/`useSearchParams`. `04-linking-and-navigating.md:345-347`. Whether it updates `useParams` for a new dynamic segment is unverified. A pushState-only thread switch would also bypass `loading.tsx` and the page segment, so it is a larger change than items 1-6.
- `generateMetadata` streams for dynamic pages, so it should not block the UI by itself. `01-getting-started/14-metadata-and-og-images.md:119-121`. In this app it still shares the token fetch with `requireSignedIn()`, and it adds a Convex HTTP query. The measured gain from removing both was 0.3 to 1.3s (dev).

Convex prefetch:

- `ConvexReactClient.prewarmQuery({ query, args, extendSubscriptionFor })` subscribes now and unsubscribes later. Default 5000 ms. `node_modules/convex/dist/esm/react/client.js:22,255-261`. Docs: https://docs.convex.dev/api/classes/react.ConvexReactClient
- The Convex client dedupes identical subscriptions, so a prewarm and a later hook with the same args share one. `client.js:192-218` (`sync.subscribe` returns a shared query token).
- Args must match the hook byte for byte. For the cached paginated hook, page 0 args are `{ threadId, paginationOpts: { numItems: 20, cursor: null, id: 0 } }` (`hooks.js:257-276`). `paginationOptsValidator` accepts `id`. `node_modules/convex/dist/esm/server/pagination.js:3-10`.
- With the cache provider, a simpler prefetch is to mount a hidden component that calls the cached hooks for the hovered thread. When it unmounts, the cache keeps the subscriptions for 5 minutes.

Cache Components, PPR and Activity:

- With `cacheComponents` and `partialPrefetching`, each route has one prefetched App Shell shared by all links to it. Uncached data streams in behind Suspense. `prefetching.md:84-90`, `02-guides/instant-navigation.md:28-48` (https://nextjs.org/docs/app/guides/instant-navigation).
- Under Cache Components, reading `cookies()` outside a Suspense boundary is a build error. `02-guides/authentication-with-cache-components.md` "Step 2" (https://nextjs.org/docs/app/guides/authentication-with-cache-components). The `(chat)` layout awaits `getToken()` (cookies) at the top, so it must be restructured, or opted out with `export const instant = false`.
- Cache Components hides old routes with `<Activity>` instead of unmounting them. Up to 3 routes are preserved. `02-guides/preserving-ui-state.md:17-19` (https://nextjs.org/docs/app/guides/preserving-ui-state).
- A hidden Activity destroys its Effects, "cleaning up any active subscriptions", and recreates them when shown. https://react.dev/reference/react/Activity. Convex `useQuery` subscribes in an effect, so a hidden thread drops its subscriptions. Whether the revealed thread shows stale data or a skeleton until the query returns is unverified. Pair it with the cache provider either way.
- Whether `/c/a` and `/c/b` count as separate preserved routes with dynamic params is unverified.

## 4. Auth cost

Why `getToken` takes about 0.8s:

- Without `jwtCache`, every `getToken` does an HTTP call from the Next server to `${CONVEX_SITE_URL}/api/auth/convex/token`. `node_modules/@convex-dev/better-auth/dist/utils/index.js:41-57`.
- That endpoint runs Better Auth inside a Convex HTTP action. It loads the session, signs a JWT with a key read from the `jwks` table, and sets the `convex_jwt` cookie. `node_modules/@convex-dev/better-auth/dist/plugins/convex/index.js:420-433`. The split of the 0.8s between network, session lookup and signing is unverified. Check the HTTP action's duration in the Convex dashboard logs.
- The cache is `React.cache`, so it lasts one server request only. `node_modules/@convex-dev/better-auth/dist/nextjs/index.js:5-9,62`.

`jwtCache`:

- With `jwtCache.enabled`, `getToken` reads the `convex_jwt` cookie and returns it with no network call if `exp` plus 60s tolerance hasn't passed. `utils/index.js:55-75`.
- If a server call fails with a non-auth error while using a cached token, it retries once with a fresh token. `nextjs/index.js:71-84`.
- The cookie is set at sign-in, on `/get-session` with a session, and on every `/convex/token` call. Max age is the JWT lifetime, 15 minutes by default. `plugins/convex/index.js:44,173-202,420-433`. The browser's own token refreshes keep it fresh.
- Docs (experimental page): "Faster page loads and navigation by reusing JWT from cookies." Setup is `jwtCache: { enabled: true, isAuthError }` in `convexBetterAuthNextJs`. https://github.com/get-convex/better-auth/blob/main/docs/content/docs/experimental.mdx
- Risk: `isAuthenticated()` becomes "a JWT cookie exists and is unexpired". A session revoked elsewhere still passes page checks until the JWT expires. Convex enforces the same JWT expiry on queries, so this matches the client's existing exposure.

Static JWKS:

- Docs: Convex HTTP-side token validation "is never cached" and by default needs serial HTTP requests to fetch the JWKS. Static JWKS passes the JWKS as a data URI in `auth.config.ts` and to the `convex()` plugin. Setup: an internal action calling `auth.api.getLatestJwks()`, then `npx convex env set JWKS`. Same experimental page.
- The current config uses the JWKS URL. `convex/auth.config.ts` with `getAuthConfigProvider()`, and `node_modules/@convex-dev/better-auth/dist/auth-config.js:33-44`.

Better Auth `session.cookieCache`:

- Stores the session in a short-lived signed cookie, so `getSession` skips the database. Revoked sessions stay valid until `maxAge`. https://www.better-auth.com/docs/concepts/session-management
- Whether it speeds up the Convex `/convex/token` endpoint is unverified. The get-convex/better-auth docs don't mention it. Prefer `jwtCache`, which removes the call entirely.

Client side:

- `ConvexBetterAuthProvider` uses `initialToken` only for the first mount in the page's lifetime (module-level `initialTokenUsed`). `node_modules/@convex-dev/better-auth/dist/react/index.js:42-52`. Soft navigations don't refetch the token on the client.
- `useConvexAuth().isAuthenticated` is true only after the Convex server confirms the token. `node_modules/convex/dist/esm/react/ConvexAuthState.js:40`. Meanwhile the client pauses the socket while it fetches the token, so queries sent before confirmation still carry auth. `node_modules/convex/dist/esm/browser/sync/authentication_manager.js:50-80`. The `isAuthenticated ? args : "skip"` gate in `ThreadView` and `ThreadList` therefore costs one extra roundtrip on hard loads. It costs nothing on soft navigations.

## 5. @convex-dev/agent

- Waterfall: the stream list query is skipped until the first messages page loads (`useUIMessages.js:74-78`). The deltas query is skipped until the stream list has results (`useDeltaStreams.js:52-63`). For a thread with a live reply that is 3 serial roundtrips: page, stream list, deltas. `ThreadView` renders messages after the first, so finished threads pay only one.
- `threads.get`, the messages page and `getQueue` start in parallel. `thread !== null` is true while `thread` is still `undefined`. `src/components/chat/thread-view.tsx` lines 62-80.
- The stream query passes `numItems: 0`, and the agent returns early for it. `node_modules/@convex-dev/agent/dist/client/messages.js:16`.
- `skipStreamIds` filters streams on the client (`useDeltaStreams.js:41-44`). It doesn't reduce server work.
- Delta saves: `convex/chat/reply.ts:173` uses `throttleMs: 100`. The agent default is 250. `node_modules/@convex-dev/agent/dist/vercel/client/streaming.js:76`. Each saved delta advances the client cursor, which is a new query run of `listThreadMessages` with its auth lookups. Docs: deltas are debounced "to prevent excessive bandwidth usage", and writes never go faster than `throttleMs`. https://docs.convex.dev/agents/streaming. Raising it to 150-250 cuts query runs per reply by 1.5-2.5x. `useSmoothText` can hide the coarser updates.
- Page size: `PAGE_SIZE = 20` in `ThreadView`, server cap 100. Smaller first pages mean less markdown to render on switch. 20 is a reasonable default. Measure render time before changing it.

## 6. Convex query-side latency

- Use `withIndex` instead of `.filter`, and `.collect` only for small result sets. https://docs.convex.dev/understanding/best-practices/. The `stoppedReplies` lookup in `convex/chat/messages.ts` already uses an index range with `.take`.
- Every thread query calls `getOwnThread`, which calls `authComponent.safeGetAuthUser` (`convex/lib/guards.ts`). That does two sequential component queries (session, then user). The session lookup compares against `new Date().getTime()`. `node_modules/@convex-dev/better-auth/dist/client/create-client.js:35-69`. Convex docs: `Date.now()` in a query means the query cache is invalidated often. https://docs.convex.dev/understanding/best-practices/. Whether this disables result caching for these queries is unverified.
- Option: read `identity.subject` (the Better Auth user id, as `requireIdentity` already does for actions) in read-only queries. Convex has validated the JWT signature and expiry. The cost is that a revoked session can read until the JWT expires (15 min).
- `threads.get` reads 5 related rows in parallel (`convex/threads.ts:214-224`). Any write to those rows reruns it, but it is small. Splitting it would only pay off if one part changes often.
- Optimistic updates run when the mutation starts, and the client rolls them back once the mutation completes and queries update. https://docs.convex.dev/client/react/optimistic-updates. `src/lib/optimistic-prompt.ts` already inserts the pending prompt with `insertAtTop` into every matching messages query. With the cache provider, idle cached pages of that thread receive the update too, which is correct.

## 7. Bundle and render

- Next 16.1+ ships a Turbopack bundle analyzer: `bunx next experimental-analyze` (add `--output` to write files). It produces no build artifacts. `node_modules/next/dist/docs/01-app/02-guides/package-bundling.md:22-90` (https://nextjs.org/docs/app/guides/package-bundling).
- `src/components/chat/markdown.tsx` statically imports `streamdown`, `@streamdown/code`, `@streamdown/math` and the katex CSS. It is imported by `assistant-message.tsx`.
- `@streamdown/code` imports `shiki` and `shiki/engine/javascript` at module top. `node_modules/@streamdown/code/dist/index.js:1`. Shiki's `bundledLanguages` loads grammars on demand (unverified for this version). `@streamdown/math` statically imports `rehype-katex` and `remark-math`. `node_modules/@streamdown/math/dist/index.js:1`.
- Markdown is on the critical path for every assistant message. Lazy-loading all of it would delay the first message paint. If the analyzer shows shiki or katex as large, load only the `code`/`math` plugins lazily, when a message contains a fence or `$$`.
- React Compiler is on (`next.config.ts`). Nothing to add there.

## 8. Dev vs prod

- `next dev` compiles routes on demand as you open them. Production builds minify and hash. `node_modules/next/dist/docs/01-app/02-guides/local-development.md:9-13` (https://nextjs.org/docs/app/guides/local-development).
- Prefetching runs only in production (`prefetching.md:64`), so `loading.tsx` partial prefetch shows its full effect only under `next start`.
- React development builds do extra checks on every render. That inflates the 0.65-1.1s client phase, which includes rendering 20 messages of markdown.
- The same page lists antivirus scanning as a common dev slowdown on Windows (`local-development.md:15-25`).
- How much dev inflates these numbers is unverified for this app. Measure the same click path under `bun run build && bun run start`, against the same Convex dev deployment, before and after each change. The 0.8s token call is network plus Convex work, so dev mode affects it less.

## Not recommended / traps

- `preloadAuthQuery` or `fetchAuthQuery` in the thread page. Both await the token and an HTTP query before the RSC payload is ready, which is the current 1.1-2.1s problem. Neither can preload the paginated message list.
- Awaiting anything auth-related in a page component on a soft-navigated route. Layout-level checks don't rerun on soft navigation, but page-level ones do, and without `jwtCache` each one pays about 0.8s.
- `<Link prefetch={true}>` on every sidebar thread. It renders each dynamic page on the server ahead of time, once per visible link (30 per page of the sidebar). With today's page that is one token fetch per link. Prefetch on hover only, if at all.
- `prewarmQuery` with the default `extendSubscriptionFor` (5s). If the user hovers and clicks later than that, the work is lost. Pass a longer value or use the cache provider.
- `maxIdleEntries` in `ConvexQueryCacheProvider` is not LRU. Once full, newly idle subscriptions are dropped at once (`provider.js:89`).
- Cached hooks with differently shaped args. Cached `usePaginatedQuery` without `customPagination: true` against the agent's stream pagination can leave gaps or overlaps between pages (`README.md:711-714`).
- `@convex-dev/react-query` for messages. No paginated support (README TODO).
- `dynamic()` import of the whole markdown renderer. It adds a chunk fetch before the first assistant message can paint.
- Turning on `cacheComponents` as a quick fix. The `(chat)` layout's top-level `getToken()` breaks the build. Activity also changes Effect timing (dropdowns, focus, `markRead` effects in `ThreadView`). Plan it as its own project.
- Judging any change by `next dev` timings alone. Prefetching is off and compilation is on demand.
