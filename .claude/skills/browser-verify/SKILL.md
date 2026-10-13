---
name: browser-verify
description: Take control of a real browser to check the a8 app. Open pages, click and type, sign in, resize to phone width, and take screenshots as proof. Use whenever the user asks to verify something in the browser, test a flow end to end, take screenshots or screenshot proof, or confirm a UI change before a PR. The Playwright MCP server is set up in .mcp.json, so never stop at "no Puppeteer or Playwright installed".
---

# Verify in the browser

Use the Playwright MCP tools (`mcp__playwright__browser_*`), which `.mcp.json` registers. They drive the installed Google Chrome in a visible window. Don't look for scripts from old sessions, and don't report that a browser tool is missing.

## Before you start

- **The app** runs on the `PORT` in this checkout's `.env.local`, or 3000 in the main checkout. Read it first and use that port everywhere below. Every linked worktree has its own port, deployment and `.env.local`, written by Orca's setup hook (`orca.yaml`, `scripts/worktree-setup.ts`). Other worktrees run on other ports, so never assume 3000, and confirm the page is this branch's. Check it with `curl -s -o /dev/null -w "%{http_code}" http://localhost:<PORT>`. If nothing answers, start `bun dev` in the background and wait until it does. If a worktree has no `.env.local`, run `bun scripts/worktree-setup.ts`.
- **Convex changes:** the functions come from this worktree's own Convex dev deployment (`CONVEX_DEPLOYMENT` in `.env.local`), so pushing never touches other worktrees. After changing `convex/`, push with `bunx convex dev --once`. /pr deletes this deployment after the PR merges (`bun scripts/worktree-teardown.ts`), so don't keep data in it you need later.
- **Stale styles:** if classes seem to do nothing, Turbopack is serving stale CSS. Restart `bun dev`.

## Drive it

1. Open the page with `browser_navigate`.
2. Call `browser_snapshot`. It lists the page's elements with refs (`[ref=e13]`), which `browser_click`, `browser_type` and `browser_fill_form` take. Check each tool's schema for argument names.
3. Confirm each step from a fresh snapshot (URL, text, enabled or disabled) instead of assuming it worked.
4. For phone width, call `browser_resize` with 390 × 844.

## Signing in

The browser keeps its own profile, so a session carries over between runs. If a page lands on `/sign-in`, sign in with the shared dev e2e account. Read `E2E_EMAIL` and `E2E_PASSWORD` from this checkout's `.env.local` (gitignored; copied from the main checkout into worktrees). It's email-verified and already has threads and connections. The main dev deployment has it, and the worktree setup hook seeds it into each new worktree deployment. Only sign up a new account if that sign-in fails. Don't use Google sign-in.

Sending a chat message costs a model call, so only send one when the check needs a reply.

## Screenshots as proof

- Call `browser_take_screenshot` with `filename: ".playwright-mcp/<name>.png"` (gitignored), and `fullPage: true` for the whole page. A bare file name saves to the repo root.
- The tool returns the image. Look at it, and only call it proof once it shows the change.
- Attach them to the PR yourself with `gh`'s `--attach` flag, written as `<file>#<alt text>`. It works on `gh pr create`, `gh pr edit <n>` and `gh pr comment <n>`, and you can repeat it up to 50 times per command. If the body references a file as `![alt](./.playwright-mcp/x.png)`, gh rewrites that reference to the uploaded image; files the body doesn't reference get added to the end. Don't ask the user to drag them in.

## If the tools aren't there

MCP servers load when a session starts, and the user approves this project's server once. If there are no `mcp__playwright__` tools, tell the user to approve `playwright` under `/mcp`, or to restart the session.

On a new machine, the server needs Node.js 20 or later and Google Chrome. `bunx` downloads the pinned `@playwright/mcp` on first use.
