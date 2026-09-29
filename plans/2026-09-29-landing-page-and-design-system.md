# a8: Design system and landing page

> **Status:** In progress · **Started:** 2026-09-29 · **Target:** 2026-09-29
>
> **Tracking:** each box is ticked when its step is done. Legend: `[x]` done · `[ ]` to do · 👤 a step you do yourself.

## Context

The spec schedules the landing page for week 8. It was pulled forward on request, together with a new look for the whole app, modeled on Contentport's screens (indigo, cool grays, rounded type, buttons with a darker bottom edge, a tilted highlight behind key words, dot-grid canvases).

Copy rules for the page:
- Plain words, second person, short sentences. Most of it comes from the spec's own lines: the "non-technical friend" pitch, the 30-second demo and the objections table.
- No invented numbers: no user counts, ratings or testimonials.
- No em dashes, and none of the usual filler ("seamless", "unlock", "supercharge").

**Committed in two parts.** The design system and landing page went in first, on their own (`105123d`). The steps that depend on the Week 1 auth work (M1 and M2) went in with the auth commit after review.

## Design system

- [x] Tokens in `src/app/globals.css`, taken from Tailwind's indigo and gray scales:
  - `--primary` is indigo-600.
  - `--background` is gray-50, `--card` is white and `--muted` is gray-100.
  - `--muted-foreground` sits between gray-500 and gray-600, so body copy passes AA on gray-100.
  - Dark-mode values are updated to match, though nothing turns dark mode on yet.
- [x] New tokens, each registered in `@theme inline`:
  - `--primary-edge`: the bottom edge of buttons.
  - `--highlight`: the marker behind words and @mentions.
  - `--success`: check marks and "connected" dots.
- [x] Added a `bg-dots` utility for dot-grid surfaces.
- [x] Font: Rubik (variable) replaces Inter as `--font-sans`. Dropped Geist Sans, which was loaded but never used. Geist Mono stays for code.
- [x] `Button`:
  - `default` and `outline` sit on a darker bottom edge, drawn as an inset shadow `--edge` deep. Each size sets `--edge` (2 to 4px).
  - Matching bottom padding keeps the label centered on the face.
  - Labels are `font-semibold`.
  - New `xl` size for calls to action.
- [x] `InputGroupButton` sets `--edge:0px`, so buttons inside fields stay flat. (`cn` doesn't merge an arbitrary `shadow-[…]` with `shadow-none`, so the edge is switched off through the variable instead.)
- [x] `Input`, `Textarea` and `InputGroup` use `bg-card`, so fields stay white on gray pages.
- [x] Added `src/components/logo.tsx`: a two-ring "8" mark plus the wordmark. The auth pages use it in place of the sparkles placeholder, and their background is now the dot grid.

## Routing

- [x] The landing page owns `/`, in a `(marketing)` route group whose layout holds the header and footer.
- [x] The app moved to `/chat`, with `APP_HOME` in `src/lib/safe-redirect.ts`. It's the default after sign-in, and `withNext` leaves `?next=` off for it. The Week 1 plan's M4 is updated to match.
- [x] `proxy.ts`: the matcher ends in `.+`, so `/` stays public while everything else is still protected by default.
- [x] The header shows "Open a8" to signed-in visitors. `isAuthenticated()` reuses the token the root layout already fetched, because it's `React.cache`d.

## Landing page (`src/app/(marketing)/page.tsx`, parts in `src/components/landing/`)

- [x] Header: logo, Pricing, GitHub, Sign in, Get started.
- [x] Hero:
  - headline "The AI chat that *does the work* in your apps"
  - the spec's plain pitch
  - "Start for free" and "View on GitHub" buttons
- [x] Product demo (`chat-demo.tsx`): the 30-second demo as a static, `inert` mock.
  - `@slack` summary, then `@gmail` draft, then an approval card, then the composer with active-app chips.
  - Screen readers get a caption instead of the mock.
- [x] App strip: the five launch apps with their @handles, plus "Any MCP server".
- [x] "Without switching tabs:" three-line section, echoing the reference site's "Within 60 seconds".
- [x] Feature cards: one-click connect, approval before any write, any model. Each has a small sketch of the real screen.
- [x] Open-source band: AGPL-3.0, self-hosting, encrypted tokens, built in public, and a terminal showing the planned Docker Compose steps.
- [x] Pricing from the spec's locked decisions: Free, Pro at $12, and Self-host, with the credit definition.
- [x] FAQ: the spec's objections, rewritten, using the shadcn `Accordion`.
- [x] Final call to action and footer.
- [x] Added shadcn `badge` and `accordion`.

## Verification

- [x] `bun run typecheck` and `bun run lint` pass.
- [x] The design-system commit passes typecheck and lint on its own, checked out in a separate worktree without the auth work.
- [x] Signed out: `/` returns 200. `/chat` redirects to `/sign-in`, and `/chat?x=1` and `/c/abc` redirect with `next` set.
- [x] Screenshots checked at 1440px and at 390px (in a 390px iframe, since headless Chrome won't go below about 500px wide): no sideways scroll, the pricing lists line up, and the approval card header wraps cleanly.
- [x] The sign-in and sign-up pages pick up the new look without layout changes.
- [ ] 👤 Check the copy reads right to you, especially anything describing v0.1 before it ships:
  - pricing and the credit limits
  - self-hosting with Docker Compose
  - `.env.example`
  - `@calendar` as Google Calendar's handle

## Split sign-in and sign-up pages (added 2026-09-29, on request)

- [x] `(auth)/layout.tsx`: two columns on large screens.
  - Left: the logo and the form, on the page background.
  - Right: `auth-showcase.tsx` on the dot grid, with "Nothing gets sent until *you say so.*", one line of copy and the landing page's approval card, static and `inert`.
  - Below `lg`, only the form shows.
- [x] The reference's testimonial is replaced by the product panel, since there are no real quotes yet.
- [x] The forms lose their `Card` wrapper for a large left-aligned `h1` and description. Submit and Google buttons are `lg`. The separator no longer needs a background override.
  - Form logic is untouched.
  - The sign-in subtitle is now "Sign in to pick up where you left off."
- [x] `ApprovalCard` and `UserMessage` are exported from `chat-demo.tsx` for reuse.
- [x] Checked in screenshots at 1440px (both pages) and 390px (sign-in). Typecheck and lint pass.

## Follow-ups (not done)

- [ ] Real app logos in the app strip, once there's a decision on using brand marks.
- [ ] Privacy and Terms pages. Google verification needs them in week 5, and the footer has space for them.
