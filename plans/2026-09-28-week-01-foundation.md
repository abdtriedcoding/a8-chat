# a8: Week 1 implementation plan (Sep 28 to Oct 2, 2026)

> **Status:** In progress · **Started:** 2026-09-28 · **Target:** 2026-10-02
>
> **Tracking:** this file is the tracked copy of the Week 1 plan. Each box is ticked when its step is done, and the ticks are committed with the work. Legend: `[x]` done · `[ ]` to do · 👤 a step you do yourself.

## Context

`Product_Spec.md` defines Week 1 as the foundation. You've asked for the product first, so this week covers:
- **Sign-in:** email and Google, through Better Auth's Convex component.
- **Chat:** threads with streaming replies, through the Convex Agent component and OpenRouter.
- **The repo:** a public GitHub repo, `abdtriedcoding/a8-chat`.

`Product_Spec.md` stays gitignored for now. CI, the community files and the docs wait for a final setup pass, and the spec gets published in that pass too.

The repo today is a clean scaffold:
- Next 16.3.6, React 19.2.8, Convex 1.46.0, Tailwind v4, and shadcn (Button only)
- **bun 1.4.2** as the package manager; Node.js is not installed
- an empty Convex schema, and no auth or AI packages

**By Friday you can:**
- sign up with email or Google
- start a chat and watch the reply stream in
- reopen past threads from a sidebar
- see only your own threads

**Not in Week 1.** These are Week 2:
- the model picker, models table and cron
- stop, regenerate and edit
- uploads
- markdown and code rendering
- automatic titles
- the settings page and encrypted key
- web search
- the rate limiter

## Decisions for this week

- **Chat UI:** shadcn's own chat components (`message-scroller`, `message`, `bubble`, `marker`), per the project's shadcn rule in `.agents/skills/shadcn/rules/chat.md`. We won't install Vercel AI Elements: it's typed against AI SDK v6, and the Agent needs v7.
- **Pinned versions:**
  - `better-auth@~1.6.15`. `@convex-dev/better-auth@0.12.5` requires `>=1.6.11 <1.7`, and a plain install would pull 1.7.x, which the component rejects.
  - `@convex-dev/agent@~0.7.3`, together with `ai@^7`, `@ai-sdk/provider@^4`, `@ai-sdk/provider-utils@^5`, `@openrouter/ai-sdk-provider@^3.1`, `convex-helpers@^0.1.103` and `zod@^4`.
- **Sign-up safety:**
  - No email verification yet, because there's no email sender until Resend.
  - **Account linking stays off** (`account.accountLinking.enabled: false`). Otherwise someone could create an unverified account with another person's email, and that person's later Google sign-in would merge into it.
  - Turn both on when Resend lands.
- **Model:** one server-side `DEFAULT_MODEL` env var, with a verified cheap fallback slug in code. `resolveModelId()` is where the Week 2 per-thread model choice plugs in.
- **Identity:**
  - The Agent thread's `userId` is the app's `users._id` (a string). The server always sets it and never takes it from client arguments.
  - The Better Auth user `_id` (the JWT subject) is stored as `users.authUserId`.
- **Commands:** bun throughout (`bun add`, `bunx convex …`, `bunx --bun shadcn@latest …`).

## Already done

- [x] Next.js, Convex, TypeScript, Tailwind and shadcn/ui set up (commits `06c9193`, `41cd110`, `81c9624`)
- [x] Git history checked for secrets before going public: no `.env*` file ever committed, and no key patterns in any commit (checked during planning)
- [x] `gh` CLI signed in as `abdtriedcoding`, with `repo` and `workflow` scopes; `a8-chat` doesn't exist yet

## Steps you do yourself

- [ ] 👤 Claim the a8 handles on X (and a GitHub org later, if you want one)
- [ ] 👤 Google Cloud: create a Web OAuth client
  - origin `http://localhost:3000`
  - redirect URI `http://localhost:3000/api/auth/callback/google`
  - add yourself as a test user
- [ ] 👤 Create an OpenRouter API key, and pick a cheap default model slug on openrouter.ai/models
- [ ] 👤 Share the values, or set them yourself, for the Convex env vars (see Env below)

## M0: Public repo

- [x] Create a `plans/` folder at the repo root for long-term plan tracking. It sits outside `docs/` so it never ends up on the future Fumadocs site.
  - `plans/README.md`: what the folder is for, the naming rule (`YYYY-MM-DD-<slug>.md`, dated to the plan's start), the checkbox legend, and an index table (plan, dates, status).
  - `plans/2026-09-28-week-01-foundation.md`: this plan, from here on the tracked copy.
  - Future weeks' plans go in the same folder, e.g. `2026-10-05-week-02-models-and-polish.md`.
- [x] Add `Product_Spec.md` to `.gitignore`, then commit `chore: keep product spec local until launch` together with the `plans/` folder.
- [x] Add `package.json` scripts: `typecheck: "next typegen && tsc --noEmit && tsc --noEmit -p convex"` and `dev:convex: "convex dev"`. `next typegen` is needed because `layout.tsx` uses the generated `LayoutProps` type.
- [x] Create the repo **without pushing**:

  `gh repo create abdtriedcoding/a8-chat --public --source=. --remote=origin --description "Open-source AI workspace that gets work done across your apps"`
- [x] Turn on secret scanning and push protection **before the first push**:
  - `gh api -X PATCH repos/abdtriedcoding/a8-chat -f "security_and_analysis[secret_scanning][status]=enabled" -f "security_and_analysis[secret_scanning_push_protection][status]=enabled"`
  - Confirm both with `gh api repos/abdtriedcoding/a8-chat --jq .security_and_analysis`.
- [x] Run `git push -u origin main`.
- [x] **Check:**
  - The repo is public at github.com/abdtriedcoding/a8-chat.
  - `Product_Spec.md` is not on GitHub.
  - `bun run typecheck` and `bun run lint` pass.

## M1: Auth backend (Convex)

- [ ] Run `bun add @convex-dev/better-auth@~0.12.5 better-auth@~1.6.15`.
- [ ] **Set the env vars first.** Convex won't push a config whose required env keys are missing.
  - `bunx convex env set BETTER_AUTH_SECRET=<random 32 bytes, base64>`
  - `bunx convex env set SITE_URL=http://localhost:3000`
  - Always use the `NAME=VALUE` form.
- [ ] `convex/convex.config.ts`:
  - `defineApp({ env: {...} })`: `SITE_URL` and `BETTER_AUTH_SECRET` as `v.string()`, the rest as `v.optional(v.string())`.
  - Never declare `CONVEX_SITE_URL`.
  - `app.use(betterAuth)`.
- [ ] `convex/auth.config.ts`: `{ providers: [getAuthConfigProvider()] } satisfies AuthConfig`. This file is mandatory; without it everyone is silently signed out.
- [ ] `convex/schema.ts`: the `users` table (see Key designs).
- [ ] `convex/auth.ts`:
  - `createClient<DataModel>(components.betterAuth, { authFunctions, triggers })`, typing `authFunctions: AuthFunctions = internal.auth` explicitly to break the type cycle.
  - User triggers: `onCreate` inserts a `users` row (with `image ?? undefined`), `onUpdate` patches it, and `onDelete` deletes it. Export all three from `triggersApi()`.
  - `createAuthOptions(ctx)`:
    - explicit `baseURL: env.SITE_URL` and `secret: env.BETTER_AUTH_SECRET`
    - `database: authComponent.adapter(ctx)`
    - email and password sign-in, without verification
    - Google only when both Google env vars are set
    - account linking off
    - `plugins: [convex({ authConfig })]`
    - `betterAuth` imported from `better-auth/minimal`
  - `createAuth`.
  - An `enabledProviders` query that returns `{ google: boolean }`.
- [ ] `convex/http.ts`: `authComponent.registerRoutes(http, createAuth)`.
- [ ] `convex/lib/access.ts`: `getViewer` and `requireViewer`.
- [ ] `convex/users.ts`: a `viewer` query returning `{ _id, name, email, image } | null`. It never throws.
- [ ] Run `bunx convex dev --once`, then **commit `convex/_generated`**.
- [ ] **Check:**
  - The push succeeds.
  - `<CONVEX_SITE_URL>/api/auth/ok` returns `{"ok":true}`.
  - The `betterAuth` component shows in the dashboard.

## M2: Auth UI (Next.js)

- [ ] Run `bunx --bun shadcn@latest add card field input label alert sonner separator spinner`.
- [ ] Add `NEXT_PUBLIC_SITE_URL=http://localhost:3000` to `.env.local`.
- [ ] `src/lib/auth-client.ts`: `createAuthClient({ plugins: [convexClient()] })`.
- [ ] `src/lib/auth-server.ts`: `convexBetterAuthNextJs({ convexUrl, convexSiteUrl })`, exporting `handler`, `isAuthenticated`, `getToken` and `fetchAuth*`.
- [ ] `src/app/api/auth/[...all]/route.ts`: `export const { GET, POST } = handler`.
- [ ] `src/app/ConvexClientProvider.tsx`: swap `ConvexProvider` for `ConvexBetterAuthProvider` (`client`, `authClient`, `initialToken`).
- [ ] `src/app/layout.tsx`:
  - `const token = await getToken()`, passed to the provider
  - add `<Toaster />`
  - replace the "Create Next App" metadata
- [ ] `src/proxy.ts` (Next 16 renamed middleware to proxy):
  - Only a quick cookie check: if `getSessionCookie(req)` is missing, redirect to `/sign-in?next=…`.
  - The matcher excludes `api`, `_next`, static files and the sign-in and sign-up pages.
  - Never redirect a signed-in user away from sign-in. A stale cookie would cause a redirect loop.
- [ ] `src/lib/safe-redirect.ts`: only allow paths that start with `/` and not `//`.
- [ ] `src/app/(auth)/layout.tsx`, `sign-in/page.tsx` and `sign-up/page.tsx`: server pages that run `if (await isAuthenticated()) redirect(safeNext)`.
- [ ] `src/components/auth/sign-in-form.tsx`, `sign-up-form.tsx` and `google-button.tsx`:
  - Card and Field layout, with errors shown inline.
  - The Google button shows only when `enabledProviders.google` is true.
  - On success, call `router.replace(next)` and then `router.refresh()`.
- [ ] 👤 Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the Convex env.
- [ ] **Check:**
  - Email sign-up creates rows in both `users` and the component's user table.
  - `users.viewer` is not null when signed in. If it is null, `auth.config` or `SITE_URL` is wrong.
  - A reload keeps the session.
  - When signed out, `/` redirects to sign-in.
  - Google sign-in completes the full round trip.

## M3: Agent backend

- [ ] Run `bun add @convex-dev/agent@~0.7.3 ai@^7 @ai-sdk/provider@^4 @ai-sdk/provider-utils@^5 @openrouter/ai-sdk-provider@^3.1.0 convex-helpers@^0.1.103 zod@^4`.
- [ ] Set `OPENROUTER_API_KEY` and `DEFAULT_MODEL` in the Convex env. Add both as optional keys in `convex.config.ts`, along with `app.use(agent)`.
- [ ] `convex/lib/models.ts`:
  - `FALLBACK_MODEL_ID`
  - `resolveModelId()`, which returns `env.DEFAULT_MODEL ?? FALLBACK`
  - `chatModel(id)`, which returns `createOpenRouter({ apiKey, headers: { "HTTP-Referer": SITE_URL, "X-Title": "a8" } }).chat(id, { usage: { include: true } })`
  - `assertModelConfigured()`
- [ ] `convex/lib/agent.ts`: `chatAgent = new Agent(components.agent, { name: "a8", languageModel, instructions, usageHandler })`.
  - For now, `usageHandler` only logs usage and `providerMetadata.openrouter.usage.cost`.
  - Don't add `"use node"`.
- [ ] `convex/lib/text.ts`:
  - `normalizePrompt`: trim, and reject empty prompts or prompts over 16k characters.
  - `titleFromPrompt`: cut to about 60 characters at a word boundary.
- [ ] `convex/lib/access.ts`: add `getOwnedThread` and `requireOwnedThread`.
- [ ] `convex/chat.ts`: `startThread`, `sendMessage`, `listThreadMessages`, `streamReply` and `enqueueReply` (see Key designs).
- [ ] `convex/threads.ts`: `list`, `get` and `remove`.
- [ ] Run `bunx convex dev --once`, then commit `_generated`.

## M4: Chat UI

- [ ] Run `bunx --bun shadcn@latest add sidebar message-scroller message bubble marker empty input-group dropdown-menu avatar skeleton alert-dialog tooltip`.
- [ ] Check the props of these new components: `bunx --bun shadcn@latest docs message-scroller message bubble sidebar input-group`.
- [ ] Delete `src/app/page.tsx`. Create `src/app/(chat)/layout.tsx` with `SidebarProvider`, `AppSidebar` and `SidebarInset`, and no auth logic.
- [ ] `src/app/(chat)/page.tsx`: an `isAuthenticated()` guard, then `<NewChat />`.
- [ ] `src/app/(chat)/c/[threadId]/page.tsx`: `const { threadId } = await props.params`, then a guard, then `<ThreadView />`. Add an `error.tsx` next to it.
- [ ] `src/components/app-sidebar.tsx`, `thread-list.tsx` and `nav-user.tsx`:
  - The thread list uses paginated `api.threads.list`, newest first.
  - It shows the active link, a skeleton while loading, an empty state and "load more".
  - Delete sits in a dropdown menu and asks for confirmation in an alert dialog.
  - Sign out calls `authClient.signOut()`, then `window.location.assign("/sign-in")`.
- [ ] `src/components/chat/composer.tsx`:
  - `InputGroup`, with `InputGroupTextarea` and `InputGroupButton`.
  - Enter sends; Shift+Enter adds a new line.
  - Disabled while a send is in flight or a reply is pending or streaming.
- [ ] `src/components/chat/new-chat.tsx`: an empty state plus the composer. Submitting calls `startThread({ prompt })`, then `router.push("/c/" + threadId)`.
- [ ] `src/components/chat/chat-message.tsx`:
  - The user's message: `Message align="end"` wrapping a `Bubble`.
  - The assistant's message: `Message align="start"` with `useSmoothText(m.text, { startStreaming: m.status === "streaming" })`, rendered as plain `whitespace-pre-wrap` text.
  - A failed reply: `Bubble variant="destructive"`.
- [ ] `src/components/chat/message-list.tsx`:
  - Data comes from `useUIMessages(api.chat.listThreadMessages, { threadId }, { initialNumItems: 20, stream: true })`.
  - Nesting: `MessageScrollerProvider autoScroll` › `MessageScroller` › `Viewport` › `Content` › `MessageScrollerItem` (with `messageId={m.key}`, and `scrollAnchor` on the user's messages), plus a `MessageScrollerButton`.
  - "Load earlier" pages back through history.
  - A "Thinking…" row uses the `shimmer` utility and has a 60-second stale guard.
- [ ] `src/components/chat/thread-view.tsx`:
  - `threads.get` returning `null` shows "Chat not found".
  - Otherwise it renders a header, the MessageList and the Composer.
  - Send uses `useMutation(api.chat.sendMessage).withOptimisticUpdate(optimisticallySendMessage(api.chat.listThreadMessages))`.
- [ ] `src/lib/errors.ts`: `errorMessage(e)` reads `ConvexError.data.message` and falls back to a generic message.
- [ ] Commit, then push to `main`.

## Key designs

**Schema (`convex/schema.ts`)**

```ts
users: defineTable({
  authUserId: v.string(),   // Better Auth user _id == JWT subject
  email: v.string(),
  name: v.string(),
  image: v.optional(v.string()),
  plan: v.union(v.literal("free"), v.literal("pro")),  // set now to avoid a Week 7 backfill
}).index("by_authUserId", ["authUserId"])
```

- **No `threadMeta` table yet.** The Agent thread already stores `userId` and `title`.
- **Week 2 adds `threadMeta`** (`{ threadId, userId, model?, activeApps? }`), created inside `startThread`, the only place threads are created. A thread with no row uses the defaults.
- **Week 2 adds two optional fields to `users`**, `defaultModel` and `favoriteModels`, so no migration is needed.

**Access helpers (`convex/lib/access.ts`)**
- **`getViewer(ctx)`**
  - Calls `authComponent.safeGetAuthUser(ctx)`, then looks up the `users` row by `authUserId`.
  - It checks that the session is live, so a sign-out or revoked session takes effect immediately.
- **`requireViewer(ctx)`** throws `ConvexError({ code: "UNAUTHENTICATED" })`.
- **`getOwnedThread(ctx, threadId, viewerId)`** calls `getThreadMetadata(ctx, components.agent, { threadId })` inside a try/catch, and returns the thread only if `thread.userId === viewerId`.
- **`requireOwnedThread`**
  - Throws `NOT_FOUND` whether the thread is missing or belongs to someone else, so it never reveals that a thread exists.
  - It **always** throws, unlike the helper in the Agent example.
- **Signed-out behaviour:** public queries for the sidebar and header return `null` or an empty page. Mutations and `listThreadMessages` throw.

**`convex/chat.ts`**
- **`startThread({ prompt }) → { threadId }`**
  1. `requireViewer`, `normalizePrompt` and `assertModelConfigured`.
  2. `createThread(ctx, components.agent, { userId: viewer._id, title })`.
  3. `enqueueReply`.
- **`sendMessage({ threadId, prompt }) → null`**
  - The arguments must be exactly these for `optimisticallySendMessage` to work.
  - Runs `requireViewer`, `requireOwnedThread`, `assertModelConfigured`, then `enqueueReply`.
- **`listThreadMessages({ threadId, paginationOpts, streamArgs: vStreamArgs })`** checks ownership, then returns `{ ...listUIMessages(...), streams: syncStreams(...) }`.
- **`enqueueReply`**
  - `chatAgent.saveMessage(ctx, { threadId, userId, prompt, skipEmbeddings: true })`.
  - Then `ctx.scheduler.runAfter(0, internal.chat.streamReply, {...})`.
  - The Week 2 rate-limit check goes here.
- **`streamReply` internalAction (`{ threadId, promptMessageId, userId }`)**
  - `chatAgent.streamText(ctx, { threadId, userId }, { promptMessageId, model: chatModel(resolveModelId()) }, { saveStreamDeltas: { chunking: "word", throttleMs: 100 } })`.
  - Then **`await result.consumeStream()`**.

**`convex/threads.ts`**
- **`list({ paginationOpts })`**
  - `components.agent.threads.listThreadsByUserId` with `userId: viewer._id` and `order: "desc"`.
  - Never pass `undefined` as the user ID: that would list the threads that have no owner.
- **`get({ threadId })`** returns `{ _id, title } | null`.
- **`remove({ threadId })`** runs `requireOwnedThread`, then `chatAgent.deleteThreadAsync`.

**Failures**

| Failure | Caught by | What the user sees |
|---|---|---|
| Missing key, empty prompt, not signed in, or not the owner | Mutation, before anything is saved | A toast; the optimistic message rolls back |
| Model or provider error | The Agent marks the pending message `failed` | A destructive bubble ("Couldn't get a reply…"); the composer re-enables |
| Error before the Agent saves anything (rare) | Client-side guard | "Thinking…" changes to a Marker after 60 seconds: "No reply received. Try again." |

## Env

**`.env.local`**
- `convex dev` already wrote `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL`.
- Add `NEXT_PUBLIC_SITE_URL=http://localhost:3000`.

**Convex env** (`bunx convex env set NAME=value`)

| Variable | Required? | Note |
|---|---|---|
| `BETTER_AUTH_SECRET` | Required | |
| `SITE_URL` | Required | Must equal the app's origin |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional | The Google button is hidden when unset |
| `OPENROUTER_API_KEY` | Required to chat | |
| `DEFAULT_MODEL` | Optional | |

## Gotchas

- **Commit `convex/_generated`** after every `convex dev` that changes the config, schema or components.
- **A wrong `auth.config.ts` or `SITE_URL` fails silently**: every user just appears signed out. The M2 check on `users.viewer` catches this.
- **Better Auth may send `image: null`.** Convert it with `?? undefined`. A throw inside a trigger aborts the whole sign-up.
- **Bun without Node:** the Agent's `engines.node >=22` warning is harmless. Run shadcn as `bunx --bun`.
- **React Compiler lint rules reject `setState` in an effect body.** Do the 60-second guard's state update inside an interval callback instead.
- **`getToken()` in the root layout makes every route dynamic.** That's fine: the app has no static pages.
- **Better Auth's built-in rate limiter is memory-only**, so it does nothing across Convex isolates. The Rate Limiter component arrives in Week 2.
- **The repo is public but has no LICENSE yet**, so by default the code is "all rights reserved" until the final setup pass adds AGPL-3.0.

## Final setup pass (before launch; deferred at your request)

- [ ] Remove `Product_Spec.md` from `.gitignore`, and publish the spec.
- [ ] Private vulnerability reporting, Dependabot alerts, and a branch ruleset that requires CI.
- [ ] CI:
  - `oven-sh/setup-bun`, `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`
  - `dependabot.yml`, grouped, and ignoring better-auth minor and major updates
  - issue and PR templates
- [ ] README, LICENSE (AGPL-3.0), CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, and `.env.example` (plus a `!.env.example` line in `.gitignore`).
- [ ] `docs/architecture.md`, `docs/decisions/` and `docs/devlog/`. The decision records should cover this week's choices:
  - shadcn instead of AI Elements
  - the better-auth 1.6 pin
  - account linking turned off
  - `users._id` as the thread owner
  - bun
  - OpenRouter

## Verification (Week 1 is done when all of these pass)

- [ ] `bun run typecheck` and `bun run lint` pass, and `main` is pushed to the public repo with no spec file.
- [ ] Sign up, send a message from `/`, and check that:
  - you land on `/c/<id>`
  - the reply streams in word by word
  - the sidebar shows the shortened title at the top
- [ ] Reloading mid-stream resumes the stream, and a second tab shows it live. "Load earlier" works once a thread has more than 20 messages.
- [ ] A second account opening the first account's `/c/<id>` sees "Chat not found", and its sidebar lists only its own threads.
- [ ] With no key set, you get a toast and nothing gets stuck. With a bad key or model, a failed bubble shows and the composer re-enables.
- [ ] When signed out, `/c/<id>` redirects to sign-in and then back to the thread. Google sign-in works.
- [ ] `git grep -nE "sk-or-|GOCSPX-"` finds nothing real.
