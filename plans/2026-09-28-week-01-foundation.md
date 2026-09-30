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

**Deferred until there's an OpenRouter key** (added 2026-09-29): multi-model support through OpenRouter. Week 1 runs on Claude Haiku 4.5 through the Anthropic API (see the M3 scope change). The model picker, models table and cron above depend on OpenRouter, so they wait for the key too. The OpenRouter code is already in place, so turning it on is an env change.

## Decisions for this week

- **Chat UI:** shadcn's own chat components (`message-scroller`, `message`, `bubble`, `marker`), per the project's shadcn rule in `.agents/skills/shadcn/rules/chat.md`. We won't install Vercel AI Elements: it's typed against AI SDK v6, and the Agent needs v7.
- **Pinned versions:**
  - `better-auth@~1.6.15`. `@convex-dev/better-auth@0.12.5` requires `>=1.6.11 <1.7`, and a plain install would pull 1.7.x, which the component rejects.
  - `@convex-dev/agent@~0.7.3`, together with `ai@^7`, `@ai-sdk/provider@^4`, `@ai-sdk/provider-utils@^5`, `@openrouter/ai-sdk-provider@^3.1`, `@ai-sdk/anthropic@^4`, `convex-helpers@^0.1.103` and `zod@^4`.
- **Sign-up safety:**
  - No email verification yet, because there's no email sender until Resend.
  - **Account linking stays off** (`account.accountLinking.enabled: false`). Otherwise someone could create an unverified account with another person's email, and that person's later Google sign-in would merge into it.
  - Turn both on when Resend lands.
- **Model:** one server-side `DEFAULT_MODEL` env var, with a verified cheap fallback slug in code. `resolveModelId()` is where the Week 2 per-thread model choice plugs in.
  - Model IDs name their provider: `anthropic:<model>` calls Anthropic directly, and anything else is an OpenRouter slug (added 2026-09-29).
  - For now, `DEFAULT_MODEL` is `anthropic:claude-haiku-4-5-20251001`. OpenRouter comes back with its key, as an env change only.
- **Identity:**
  - Users live only in the Better Auth component's `user` table. The app keeps no copy (changed 2026-09-29; see M1).
  - The Agent thread's `userId` is the Better Auth user `_id` (the JWT subject), taken from `getViewer`. The server always sets it and never takes it from client arguments.
- **Commands:** bun throughout (`bun add`, `bunx convex …`, `bunx --bun shadcn@latest …`).

## Already done

- [x] Next.js, Convex, TypeScript, Tailwind and shadcn/ui set up (commits `06c9193`, `41cd110`, `81c9624`)
- [x] Git history checked for secrets before going public: no `.env*` file ever committed, and no key patterns in any commit (checked during planning)
- [x] `gh` CLI signed in as `abdtriedcoding`, with `repo` and `workflow` scopes; `a8-chat` doesn't exist yet

## Steps you do yourself

- [ ] 👤 Claim the a8 handles on X (and a GitHub org later, if you want one)
- [x] 👤 Google Cloud: create a Web OAuth client
  - origin `http://localhost:3000`
  - redirect URI `http://localhost:3000/api/auth/callback/google`
  - add yourself as a test user
- [ ] 👤 Create an OpenRouter API key, and pick a cheap default model slug on openrouter.ai/models. (Deferred on 2026-09-29: Week 1 uses an Anthropic key instead; see the M3 scope change.)
- [x] 👤 Share an Anthropic API key and model (`claude-haiku-4-5-20251001`). Set on the dev deployment on 2026-09-29; it's in no repo file.
- [x] 👤 Share the values, or set them yourself, for the Convex env vars (see Env below). (Checked 2026-09-30: all are set on the dev deployment except `OPENROUTER_API_KEY`, which is deferred.)

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

- [x] Run `bun add @convex-dev/better-auth@~0.12.5 better-auth@~1.6.15`. (Resolved to `better-auth@1.6.33`.)
- [x] **Set the env vars first.** Convex won't push a config whose required env keys are missing.
  - `bunx convex env set BETTER_AUTH_SECRET=<random 32 bytes, base64>`
  - `bunx convex env set SITE_URL=http://localhost:3000`
  - Always use the `NAME=VALUE` form.
- [x] `convex/convex.config.ts`:
  - `defineApp({ env: {...} })`: `SITE_URL` and `BETTER_AUTH_SECRET` as `v.string()`, the rest as `v.optional(v.string())`.
  - Never declare `CONVEX_SITE_URL`.
  - `app.use(betterAuth)`.
- [x] `convex/auth.config.ts`: `{ providers: [getAuthConfigProvider()] } satisfies AuthConfig`. This file is mandatory; without it everyone is silently signed out.
- [x] `convex/schema.ts`: the `users` table (see Key designs).
- [x] `convex/auth.ts`:
  - `createClient<DataModel>(components.betterAuth, { authFunctions, triggers })`, typing `authFunctions: AuthFunctions = internal.auth` explicitly to break the type cycle.
  - User triggers: `onCreate` inserts a `users` row (with `image ?? undefined`), `onUpdate` patches it, and `onDelete` deletes it. Export all three from `triggersApi()`. (Removed 2026-09-29; see the scope change below.)
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
- [x] `convex/http.ts`: `authComponent.registerRoutes(http, createAuth)`.
- [x] `convex/lib/access.ts`: `getViewer` and `requireViewer`.
- [x] `convex/users.ts`: a `viewer` query returning `{ _id, name, email, image } | null`. It never throws.
- [x] **Scope change (2026-09-29): dropped the app `users` table.** It mirrored name, email and image from the component's `user` table through triggers, so every user showed up twice in the dashboard and the two copies could drift. Its only app field, `plan`, wasn't read anywhere yet.
  - `convex/schema.ts` is empty again. `convex/auth.ts` is `createClient<DataModel>(components.betterAuth)`, with no triggers or `authFunctions`.
  - `getViewer` returns `authComponent.safeGetAuthUser(ctx)`, the component's user doc. `users.viewer` returns its `_id` as a string, with `image ?? undefined`.
  - [x] 👤 In the dashboard (dev deployment), delete the leftover `users` table: Data → `users` → ⋮ → Delete table. The schema no longer defines it, but Convex keeps its 3 old rows until it's deleted. (Checked 2026-09-30: `bunx convex data` lists no app tables.)
- [x] Run `bunx convex dev --once`, then **commit `convex/_generated`**. (Committed on 2026-09-29 with the reviewed auth work.)
- [x] **Check:**
  - The push succeeds.
  - `<CONVEX_SITE_URL>/api/auth/ok` returns `{"ok":true}`.
  - The `betterAuth` component shows in the dashboard.

## M2: Auth UI (Next.js)

- [x] Run `bunx --bun shadcn@latest add card field input label alert sonner separator spinner`. (Also pulled in `sonner` and `next-themes`.)
- [x] Add `NEXT_PUBLIC_SITE_URL=http://localhost:3000` to `.env.local`.
- [x] `src/lib/auth-client.ts`: `createAuthClient({ plugins: [convexClient()] })`. It also passes `baseURL: NEXT_PUBLIC_SITE_URL`, because SSR has no `window.location` to fall back on.
- [x] `src/lib/auth-server.ts`: `convexBetterAuthNextJs({ convexUrl, convexSiteUrl })`, exporting `handler`, `isAuthenticated`, `getToken` and `fetchAuth*`.
- [x] `src/app/api/auth/[...all]/route.ts`: `export const { GET, POST } = handler`.
- [x] `src/app/ConvexClientProvider.tsx`: swap `ConvexProvider` for `ConvexBetterAuthProvider` (`client`, `authClient`, `initialToken`). Needs a type-only cast; see Gotchas.
- [x] `src/app/layout.tsx`:
  - `const token = await getToken()`, passed to the provider
  - add `<Toaster />`
  - replace the "Create Next App" metadata
- [x] `src/proxy.ts` (Next 16 renamed middleware to proxy):
  - Only a quick cookie check: if `getSessionCookie(req)` is missing, redirect to `/sign-in?next=…`.
  - The matcher excludes `api`, `_next`, static files and the sign-in and sign-up pages.
  - Never redirect a signed-in user away from sign-in. A stale cookie would cause a redirect loop.
- [x] `src/lib/safe-redirect.ts`: only allow paths that start with `/` and not `//`. It also runs a URL-parser origin check, which catches `/\evil.com` and tab tricks, and exports `withNext()` for carrying `?next=` between pages.
- [x] `src/app/(auth)/layout.tsx`, `sign-in/page.tsx` and `sign-up/page.tsx`: server pages that run `if (await isAuthenticated()) redirect(safeNext)`.
- [x] `src/components/auth/sign-in-form.tsx`, `sign-up-form.tsx` and `google-button.tsx`:
  - Card and Field layout, with errors shown inline.
  - The Google button shows only when `enabledProviders.google` is true. The pages fetch this on the server, so the button doesn't pop in after load.
  - On success, call `router.replace(next)` and then `router.refresh()`.
  - OAuth failures come back as `/sign-in?error=…` and show inline; `account_not_linked` gets its own message.
- [x] Auth UI rework (added 2026-09-29: the first pass rendered with stale CSS and looked broken; see Gotchas).
  - Run `bun add react-hook-form zod @hookform/resolvers` and `bunx --bun shadcn@latest add input-group`.
  - Forms follow shadcn's react-hook-form pattern: a zod schema, `zodResolver`, and a `Field` per input, with `data-invalid` on `Field`, `aria-invalid` on the control and `FieldError` for the message. Server and OAuth errors go through `setError("root")` and show in an `Alert`.
  - Inputs use `form.register()` with no `defaultValues`, not `Controller`. Controlled inputs lose anything typed or autofilled before hydration: the box looks filled, but the form submits it as empty. With no default, `register()` reads the value that's already in the input.
  - Layout follows shadcn's `login-03` block: muted page, brand mark, centered card.
  - `src/components/auth/password-input.tsx`: `InputGroup` with a show/hide toggle.
  - Both forms set `method="post"`. A submit that lands before hydration otherwise goes out as a native GET, with the password in the URL.
  - Sign-out keeps the viewer card on screen until the redirect lands. `users.viewer` turns null as soon as the session ends, which flashed the "viewer is null" alert.
  - `globals.css` scans only `src/` (`@import "tailwindcss" source("..")`), so the example classes in the `.agents/` and `.claude/` skill docs stop shipping as CSS.
- [x] Temporary home page (`src/app/page.tsx` + `src/components/auth/viewer-card.tsx`): shows `users.viewer` and a sign-out button, so the checks below can be run by hand. M4 deletes both. (Moved to `src/app/chat/page.tsx` on 2026-09-29, when the landing page took `/`; see the scope change in M4.)
- [x] 👤 Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the Convex env. (Set on the dev deployment on 2026-09-29; they're in no repo file.)
- [ ] **Check:** everything except Google passed on 2026-09-29, over HTTP against the dev server, using a test account `m2-check-…@example.com`.
  - [x] Email sign-up creates rows in both `users` and the component's user table.
  - [x] `users.viewer` is not null when signed in. If it is null, `auth.config` or `SITE_URL` is wrong.
  - [x] A reload keeps the session.
  - [x] When signed out, `/` redirects to sign-in.
  - [x] Sign-out takes effect immediately: the same unexpired JWT gets `null` from `users.viewer`.
  - [ ] Google sign-in completes the full round trip. Checked automatically so far:
    - Google accepts the client ID and redirect URI; a control run with a wrong URI gets `redirect_uri_mismatch`.
    - The token endpoint accepts the secret; a wrong secret gets `invalid_client`.
    - A cancelled consent comes back to `/sign-in?error=access_denied` with our message.
    - Still needed: one real sign-in by hand in a browser.

## M3: Agent backend

- [x] Run `bun add @convex-dev/agent@~0.7.3 ai@^7 @ai-sdk/provider@^4 @ai-sdk/provider-utils@^5 @openrouter/ai-sdk-provider@^3.1.0 convex-helpers@^0.1.103 zod@^4`. (Resolved to agent 0.7.3, ai 7.0.122, provider 4.0.19, provider-utils 5.0.51, OpenRouter provider 3.1.0 and convex-helpers 0.1.124. `bun add` loosened the existing `zod` range to `^4`, so it was put back to `^4.6.5`.)
- [x] Add `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` and `DEFAULT_MODEL` as optional keys in `convex.config.ts`, along with `app.use(agent)`.
- [x] **Scope change (2026-09-29): Week 1 runs on Claude Haiku 4.5 through the Anthropic API.** There's no OpenRouter key yet, but there is an Anthropic key. The OpenRouter code stays, because OpenRouter remains the long-term way to offer any model. Multi-model support through OpenRouter moves to later (see "Not in Week 1").
  - Run `bun add @ai-sdk/anthropic@^4`. (Resolved to 4.0.68, on the same `@ai-sdk/provider` 4.0.19 and `provider-utils` 5.0.51 as the Agent, so there are no duplicate types.) It's the AI SDK's Anthropic provider, not `@anthropic-ai/sdk`, because the Agent takes an AI SDK model.
  - Model IDs now name their provider (see Key designs). Which one runs is set by `DEFAULT_MODEL`, so switching is an env change, not a code change.
  - [x] Set `ANTHROPIC_API_KEY` and `DEFAULT_MODEL=anthropic:claude-haiku-4-5-20251001` on the dev deployment (2026-09-29). The Models API confirmed both the key and the model ID: 200K input tokens, 64K output. Haiku 4.5 costs $1 in and $5 out per million tokens.
  - [ ] 👤 Later, to switch to OpenRouter: `bunx convex env set OPENROUTER_API_KEY=sk-or-…`, then either `bunx convex env remove DEFAULT_MODEL` (to use the fallback) or set it to an OpenRouter slug. `ANTHROPIC_API_KEY` can stay, so `anthropic:` IDs keep working.
- [x] `convex/lib/models.ts`:
  - `FALLBACK_MODEL_ID = "google/gemini-3.1-flash-lite"`: checked against the live OpenRouter model list on 2026-09-29. It costs $0.25 in and $1.50 out per million tokens, supports tools, and has no expiry date. `gemini-2.5-flash-lite` is cheaper, but OpenRouter retires it on 2026-10-20. It's the fallback for when `DEFAULT_MODEL` is unset, so the OpenRouter path stays the default.
  - `resolveModelId()`, which returns `env.DEFAULT_MODEL ?? FALLBACK`
  - `parseModelId(id)`: `anthropic:<model>` goes to Anthropic. Anything else is an OpenRouter slug, with an optional `openrouter:` prefix.
  - `chatModel(id)` builds the model from the matching entry in the `providers` table:
    - **OpenRouter:** `createOpenRouter({ apiKey, compatibility: "strict", appUrl: SITE_URL, appName: "a8" }).chat(model, { usage: { include: true } })`. This changed from the raw `headers` in the first draft: provider 3.1's `appUrl` and `appName` options set `HTTP-Referer` and `X-OpenRouter-Title`, the current name for `X-Title`. `compatibility: "strict"` is new; see Gotchas.
    - **Anthropic:** `createAnthropic({ apiKey })(model)`.
  - `assertModelConfigured(id = resolveModelId())` checks the key of that model's provider, and the error names the provider.
- [x] `convex/lib/agent.ts`: `chatAgent = new Agent(components.agent, { name: "a8", languageModel, instructions, usageHandler })`.
  - For now, `usageHandler` only logs the provider, model, token counts and `providerMetadata.openrouter.usage.cost`. The cost is `undefined` on Anthropic, whose API doesn't report one.
  - No `"use node"`.
- [x] `convex/lib/text.ts`:
  - `normalizePrompt`: trim, and reject empty prompts or prompts over 16k characters.
  - `titleFromPrompt`: collapse whitespace, then cut to about 60 characters at a word boundary. It counts code points, so the cut never splits an emoji.
- [x] `convex/lib/access.ts`: add `getOwnedThread` and `requireOwnedThread`.
- [x] `convex/chat.ts`: `startThread`, `sendMessage`, `listThreadMessages`, `streamReply` and `enqueueReply` (see Key designs).
- [x] `convex/threads.ts`: `list`, `get` and `remove`.
- [x] Run `bunx convex dev --once`, then commit `_generated`.
- [x] **Check:** all passed on 2026-09-29. The checks ran over HTTP against the dev deployment, with test accounts `m3-check-a-…`, `m3-check-b-…` and `m3-check-live-…@example.com`.
  - [x] `bun run typecheck` and `bun run lint` pass, and the push succeeds.
  - [x] When signed out, `threads.list` returns an empty page and `threads.get` returns null. `startThread`, `sendMessage`, `listThreadMessages` and `remove` throw `UNAUTHENTICATED`.
  - [x] With no key set, `startThread` throws `MODEL_NOT_CONFIGURED`, and no thread is created.
  - [x] Blank and over-16k prompts throw `INVALID_PROMPT`. A string that isn't a thread ID gives `null` from `threads.get` and `NOT_FOUND` from `sendMessage`.
  - [x] `startThread` creates the thread with a shortened title (`"Can you explain how Convex scheduled functions work, and…"`), and it's listed first for its owner.
  - [x] With an invalid key (a placeholder, set for the run and then removed), OpenRouter returns 401 and the Agent marks the reply `failed`. Nothing is left pending.
  - [x] Account B can't see account A's thread: its `threads.list` is empty, `threads.get` returns null, and `listThreadMessages`, `sendMessage` and `remove` throw `NOT_FOUND`.
  - [x] `remove` deletes the thread for its owner, and it disappears from `threads.list`.
  - [x] With Haiku 4.5 (`anthropic:claude-haiku-4-5-20251001`), a reply streams in. The stream opens in about 0.8 seconds, deltas arrive while it runs, and the reply finishes with status `success` in about 2.6 seconds.
  - [x] Thread history reaches the model: asked to repeat the earlier question word for word, the follow-up did, and its input tokens grew from 53 to 151.
  - [x] The Convex logs show a `usage` line for each reply, with the provider (`anthropic.messages`), the model and the token counts.
  - [x] `parseModelId` sends `anthropic:` IDs to Anthropic, and bare or `openrouter:` slugs to OpenRouter, including slugs with a `:` suffix such as `:batch`. With only the Anthropic key set, an OpenRouter model fails `assertModelConfigured` with a message naming OpenRouter.
  - [ ] Later, with OpenRouter: the same streaming check with an OpenRouter model, including a `usage` line with a cost. This waits for an OpenRouter key and doesn't block Week 1.

## M4: Chat UI

- [x] Run `bunx --bun shadcn@latest add sidebar message-scroller message bubble marker empty dropdown-menu avatar skeleton alert-dialog tooltip`. (Done 2026-09-29. `input-group` was dropped from the list: it was already installed and customized in M2. Also pulled in `sheet`, `src/hooks/use-mobile.ts` and `@shadcn/react@^0.3.1`.)
  - The CLI overwrites `button.tsx` and `input.tsx`, the design system's customized copies. Both were restored from git right after, and `add --diff` showed that upstream only differs in styling, so the sidebar doesn't need the upstream versions.
  - `use-mobile.ts` is rewritten with `useSyncExternalStore`: shadcn's version sets state in an effect body, which the React Compiler lint rejects. Its server snapshot is `false`, as before.
  - `TooltipProvider` wraps the app in the root layout (the sidebar's tooltips need it).
- [x] Check the props of these new components. (Read from the installed sources and the `@shadcn/react` types rather than `shadcn docs`. `MessageScrollerViewport` defaults to `preserveScrollOnPrepend`, and the provider to `defaultScrollPosition="end"`.)
- [x] **Scope change (2026-09-29): the app moved from `/` to `/chat`.** The public landing page now owns `/` (`plans/2026-09-29-landing-page-and-design-system.md`). `APP_HOME = "/chat"` in `src/lib/safe-redirect.ts` is the default after sign-in, and `proxy.ts` leaves `/` public. Threads stay at `/c/<id>`.
- [x] Delete `src/app/chat/page.tsx` and `src/components/auth/viewer-card.tsx` (the temporary M2 check page). Create `src/app/(chat)/layout.tsx` with `SidebarProvider`, `AppSidebar` and `SidebarInset`, and no auth logic.
  - The layout reads the sidebar's `sidebar_state` cookie for `defaultOpen`, so a collapsed sidebar doesn't flash open on load.
  - The shell is `h-svh`, so only the message list scrolls.
- [x] `src/app/(chat)/chat/page.tsx` (the new-chat page at `/chat`): an `isAuthenticated()` guard, then `<NewChat />`.
- [x] `src/app/(chat)/c/[threadId]/page.tsx`: `const { threadId } = await props.params`, then a guard, then `<ThreadView />`. Add an `error.tsx` next to it.
  - The guard redirects to `/sign-in?next=/c/<id>`, so a stale cookie still lands back on the thread.
  - `ThreadView` is keyed by `threadId`, so switching threads starts from fresh state.
  - `error.tsx` uses Next 16's `retry` prop and keeps the header, so the sidebar can still be opened on a phone.
- [x] `src/components/app-sidebar.tsx`, `thread-list.tsx` and `nav-user.tsx`:
  - The thread list uses paginated `api.threads.list`, newest first.
  - It shows the active link, a skeleton while loading, an empty state and "load more".
  - Delete sits in a dropdown menu and asks for confirmation in an alert dialog.
  - Sign out calls `authClient.signOut()`, then `window.location.replace("/sign-in")`. (Changed from `assign` in M2: Next's lint flags `assign` with a relative URL, and `replace` keeps the signed-in page out of history.)
  - Added: deleting drops the thread from the loaded pages optimistically. The server deletes long threads in batches and removes the thread row last, so otherwise a long thread would linger. Deleting the open thread then goes to `/chat`.
  - Added: the dialog stays open, with a spinner, until the delete lands, so a failure can show as a toast.
  - Added: on phones, following a link in the sidebar sheet closes it (`src/hooks/use-close-sidebar-on-mobile.ts`).
  - The skeleton uses fixed widths. `SidebarMenuSkeleton` picks random ones in `useState`, which differ between the server render and hydration.
  - Queries wait for `useConvexAuth()` to finish loading, as the M2 viewer card did. Otherwise they can run before the token is set and come back as signed out.
- [x] `src/components/chat/composer.tsx`:
  - `InputGroup`, with `InputGroupTextarea` and `InputGroupButton`.
  - Enter sends; Shift+Enter adds a new line. Enter is ignored while an IME is composing.
  - Disabled while a send is in flight or a reply is pending or streaming. Only sending is blocked: the box stays editable so the next message can be drafted, and the send button shows a spinner.
  - The text clears as soon as it's sent. If the send fails, it comes back (unless something new was typed) and `errorMessage` shows in a toast.
- [x] `src/components/chat/new-chat.tsx`: an empty state plus the composer. Submitting calls `startThread({ prompt })`, then `router.push("/c/" + threadId)`.
  - The push runs inside `useTransition`, so the composer stays busy until the thread page takes over.
- [x] `src/components/chat/chat-message.tsx`:
  - The user's message: `Message align="end"` wrapping a `Bubble` (`variant="tinted"`, a light indigo).
  - The assistant's message: `Message align="start"` with `useSmoothText(m.text, { startStreaming: m.status === "streaming" })`, rendered as plain `whitespace-pre-wrap` text. It has the logo as its avatar, like the landing page's demo.
  - A failed reply: `Bubble variant="destructive"`. The Agent doesn't put the error on the `UIMessage`, so the copy is fixed: "Couldn't get a reply. Send your message again to retry."
- [x] `src/components/chat/message-list.tsx`:
  - Data comes from `useUIMessages(api.chat.listThreadMessages, { threadId }, { initialNumItems: 20, stream: true })`. **Changed:** the hook is called in `thread-view.tsx`, and `MessageList` just renders what it's given, because the composer's busy state needs the same messages.
  - Nesting: `MessageScrollerProvider autoScroll` › `MessageScroller` › `Viewport` › `Content` › `MessageScrollerItem` (with `messageId={m.key}`, and `scrollAnchor` on the user's messages), plus a `MessageScrollerButton`.
  - "Load earlier" pages back through history. It's the first `MessageScrollerItem`, and the scroller still keeps the reader's place when older messages are prepended.
  - A "Thinking…" row uses the `shimmer` utility and has a 60-second stale guard.
    - The row shows while the prompt is the last message. An assistant message that has started but has no text yet shows "Thinking…" in its own place.
    - The guard's timer starts when this client first sees the prompt, not at the message's server timestamp, since the two clocks can disagree. So reopening a thread that's stuck waits 60 seconds again before giving up.
    - The list mounts only after the first page loads, so the "end" default scroll position applies to real content.
- [x] `src/components/chat/thread-view.tsx`:
  - `threads.get` returning `null` shows "Chat not found".
  - Added: if the thread was showing and then disappears (deleted from the sidebar or another tab), it says "This chat was deleted" instead.
  - Otherwise it renders a header, the MessageList and the Composer.
  - `listThreadMessages` is skipped until `threads.get` finds the thread, because it throws for threads that aren't the viewer's.
  - While loading, a skeleton replaces the list, but the composer already renders in its final place, so focus and anything typed carry over.
  - Send uses `useMutation(api.chat.sendMessage).withOptimisticUpdate(optimisticallySendMessage(api.chat.listThreadMessages))`.
- [x] `src/lib/errors.ts`: `errorMessage(e)` reads `ConvexError.data.message` and falls back to a generic message.
- [x] **Check:** all passed on 2026-09-29, in headless Chrome against `next dev` and the dev deployment, with test accounts `m4-check-…` and `m4-check-b-…@example.com`.
  - [x] `bun run typecheck` and `bun run lint` pass.
  - [x] Signed out, `/chat` redirects to `/sign-in`, and `/c/<id>` to `/sign-in?next=%2Fc%2F<id>`. Signing in there lands back on the thread.
  - [x] Sign-up lands on `/chat`, with the empty state in the sidebar.
  - [x] Sending from `/chat` goes to `/c/<id>` (1.6 seconds in dev once the route is compiled). "Thinking…" shows with the busy spinner, then the reply types out word by word. The sidebar lists the thread first, active, with its shortened title, and the header shows the same title.
  - [x] A follow-up shows up at once (the optimistic message is on screen within 60 ms) and the composer clears. A reload restores the whole thread from history.
  - [x] Reloading mid-stream resumes the reply. A second tab shows it live.
  - [x] With more than 20 messages, "Load earlier" brings in the next 20, and the message under the reader stays put (225 px from the top before, 224 px after).
  - [x] Sending while scrolled up brings the new message into view.
  - [x] Delete asks first, then goes to `/chat`, and the thread leaves the sidebar. Its URL then shows "Chat not found". A thread deleted from another tab shows "This chat was deleted".
  - [x] Account B opening account A's thread sees "Chat not found", and B's sidebar is empty.
  - [x] With `DEFAULT_MODEL` set for the run to an OpenRouter slug (there's no OpenRouter key), sending shows the toast "Chat isn't set up yet: the server has no OpenRouter API key." On `/chat` no thread is created and the prompt returns to the box. In a thread, the optimistic message rolls back (11 back to 10) and nothing stays busy.
  - [x] With `DEFAULT_MODEL` set for the run to a model that doesn't exist, the reply shows the destructive bubble and the composer re-enables. `DEFAULT_MODEL` was then set back to `anthropic:claude-haiku-4-5-20251001`.
  - [x] At 390 px: no sideways scroll, the thread opens scrolled to the end, and tapping a thread in the sidebar sheet closes the sheet.
  - [x] No console errors or warnings in any of these runs.
  - [ ] The 60-second stale guard wasn't run live: it needs an error before the Agent saves anything, which can't be caused from outside.
- [x] Commit on `feat/m3-agent-backend` and open a pull request to `main` (2026-09-30). (Changed from pushing to `main` directly. The PR also carries the two M3 commits, which weren't on `main` yet.)
  - [ ] Merge the PR into `main`.

## Key designs

**Schema (`convex/schema.ts`)**

Empty for Week 1. (It first had a `users` table mirroring the Better Auth user; dropped 2026-09-29, see M1.)

- **User profiles** (name, email, image) are read from the Better Auth component's `user` table via `getViewer`, never copied.
- **App data about a user goes in app tables keyed by the Better Auth user `_id`**, each created when it's first needed. That covers Week 2's `defaultModel` and `favoriteModels`, and Week 7's `plan` (a missing row means `"free"`, so no backfill). Don't put these on the Better Auth user with `additionalFields`: that needs a local install of the component, and by default Better Auth lets users set those fields themselves through `updateUser`.
- **No `threadMeta` table yet.** The Agent thread already stores `userId` and `title`.
- **Week 2 adds `threadMeta`** (`{ threadId, userId, model?, activeApps? }`), created inside `startThread`, the only place threads are created. A thread with no row uses the defaults.

**Model IDs (`convex/lib/models.ts`)** (added 2026-09-29)
- **The format is `<provider>:<model>`.** `anthropic:claude-haiku-4-5-20251001` calls the Anthropic API. A bare slug such as `google/gemini-3.1-flash-lite` is OpenRouter's, and `openrouter:<slug>` works too.
- **Bare slugs mean OpenRouter**, so Week 2's models table can store OpenRouter's own slugs unchanged. Only a known provider name counts as a prefix, because OpenRouter slugs can contain `:` themselves (`:free`, `:batch`).
- **Each provider is one entry in a `providers` table:** a label, its API key and a `languageModel(model)` factory. Adding a provider means adding one entry and one optional env key.
- **Switching models needs no code change.** Set the provider's key, then `DEFAULT_MODEL`. `assertModelConfigured` checks the key of whichever provider the model uses.

**Access helpers (`convex/lib/access.ts`)**
- **`getViewer(ctx)`**
  - Returns `authComponent.safeGetAuthUser(ctx)`: the component's user doc, or null.
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
| `OPENROUTER_API_KEY` | Required for OpenRouter models | Not set yet; deferred |
| `ANTHROPIC_API_KEY` | Required for `anthropic:` models | Set on dev on 2026-09-29 |
| `DEFAULT_MODEL` | Optional | A provider-prefixed model ID. Dev: `anthropic:claude-haiku-4-5-20251001`. Unset means the OpenRouter fallback |

## Gotchas

- **Commit `convex/_generated`** after every `convex dev` that changes the config, schema or components.
- **A wrong `auth.config.ts` or `SITE_URL` fails silently**: every user just appears signed out. The M2 check on `users.viewer` catches this.
- **The provider's `AuthClient` type breaks from better-auth 1.6.18 on.** `@convex-dev/better-auth@0.12.5` (the latest) was typed against 1.6.15. From 1.6.18 its `AuthClient` infers `useSession().data` as `never`, so no real client type-checks. We found this by bisecting: 1.6.17 passes and 1.6.18 fails. We stay on 1.6.33 so we keep the security fixes, and `ConvexClientProvider` casts `authClient as unknown as AuthClient`; the runtime API is unchanged. Remove the cast once the component ships newer types.
- **Better Auth stores a missing `image` as `null`.** Convert it with `?? undefined` before returning it through a `v.optional` validator.
- **Bun without Node:** the Agent's `engines.node >=22` warning is harmless. Run shadcn as `bunx --bun`.
- **React Compiler lint rules reject `setState` in an effect body.** Do the 60-second guard's state update inside an interval callback instead.
- **Turbopack dev can serve stale Tailwind CSS.** On 2026-09-29 the running `next dev` only rebuilt Tailwind when `globals.css` itself changed: classes in new or edited `.tsx` files never reached the CSS, so pages rendered without padding, gaps or widths. If a class seems to do nothing, restart `bun dev`. If it keeps happening, try `next dev --webpack`.
- **`getToken()` in the root layout makes every route dynamic.** That's fine: the app has no static pages.
- **The OpenRouter provider needs `compatibility: "strict"`.** `createOpenRouter` defaults to `"compatible"`, which leaves out `stream_options.include_usage`, so streamed replies can come back without usage or cost. (The default `openrouter` instance already uses strict.)
- **OpenRouter's 401 messages are misleading.** A malformed key gets "Missing Authentication header", even though the header was sent. A well-formed but unknown key gets "User not found", and a request with no key at all gets "No cookie auth credentials found".
- **Better Auth's built-in rate limiter is memory-only**, so it does nothing across Convex isolates. The Rate Limiter component arrives in Week 2.
- **The repo is public but has no LICENSE yet**, so by default the code is "all rights reserved" until the final setup pass adds AGPL-3.0.
- **`shadcn add` overwrites the design system's customized components.** Components that depend on `button` or `input` (sidebar, for one) rewrite `button.tsx` and `input.tsx`. The CLI asks before overwriting, but stops at that prompt when run non-interactively. Run `add --dry-run` first, then restore the customized files from git after any `--overwrite`.
- **A thread's first page of messages is a sliding window.** `useUIMessages` uses convex-helpers' `usePaginatedQuery`, whose first page stays "the newest 20" until "Load earlier" is first used, and only then is pinned. So in a long session the oldest message scrolls off the top as new ones arrive, and "Load earlier" brings it back. This is by design: it never leaves gaps or duplicates.
- **A reply reopened mid-stream types out from the start.** `useSmoothText` starts from empty when a message mounts while streaming, then speeds up to catch up with the stream. Only replies loaded after they've finished show in full at once.

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
  - users only in the Better Auth component, with its user `_id` as the thread owner
  - bun
  - OpenRouter, with direct Anthropic as the Week 1 stand-in, and provider-prefixed model IDs

## Verification (Week 1 is done when all of these pass)

- [ ] `bun run typecheck` and `bun run lint` pass, and `main` is pushed to the public repo with no spec file. (Typecheck and lint pass on the branch as of 2026-09-30. This waits on the PR merge.)
- [x] Sign up, send a message from `/chat`, and check that (M4 check, 2026-09-29):
  - you land on `/c/<id>`
  - the reply streams in word by word
  - the sidebar shows the shortened title at the top
- [x] Reloading mid-stream resumes the stream, and a second tab shows it live. "Load earlier" works once a thread has more than 20 messages. (M4 check)
- [x] A second account opening the first account's `/c/<id>` sees "Chat not found", and its sidebar lists only its own threads. (M4 check)
- [x] With no key set, you get a toast and nothing gets stuck. With a bad key or model, a failed bubble shows and the composer re-enables. (M4 check. "No key" ran as a model whose provider key is missing, which is the same `MODEL_NOT_CONFIGURED` path.)
- [ ] When signed out, `/c/<id>` redirects to sign-in and then back to the thread. Google sign-in works. (The redirect passed in the M4 check. Google still needs one sign-in by hand; see M2.)
- [x] `git grep -nE "sk-or-|sk-ant-|GOCSPX-"` finds nothing real. (2026-09-29: the only hits are this plan's own placeholder `sk-or-…` and the command itself.)
