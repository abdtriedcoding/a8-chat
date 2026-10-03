---
name: browser-verify
description: Take control of a real browser to check the a8 app. Open pages, click and type, sign in, resize to phone width, and take screenshots as proof. Use whenever the user asks to verify something in the browser, test a flow end to end, take screenshots or screenshot proof, or confirm a UI change before a PR. The Playwright MCP server is set up in .mcp.json, so never stop at "no Puppeteer or Playwright installed".
---

# Verify in the browser

Use the Playwright MCP tools (`mcp__playwright__browser_*`), which `.mcp.json` registers. They drive the installed Google Chrome in a visible window. Don't look for scripts from old sessions, and don't report that a browser tool is missing.

## Before you start

- **The app** runs at http://localhost:3000. It has to be port 3000, because Better Auth only trusts that origin. Check it with `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`. If nothing answers, start `bun dev` in the background and wait until it does.
- **Convex changes:** the functions come from the Convex dev deployment, not from local files. After changing `convex/`, push first with `bunx convex dev --once`.
- **Stale styles:** if classes seem to do nothing, Turbopack is serving stale CSS. Restart `bun dev`.

## Drive it

1. Open the page with `browser_navigate`.
2. Call `browser_snapshot`. It lists the page's elements with refs (`[ref=e13]`), which `browser_click`, `browser_type` and `browser_fill_form` take. Check each tool's schema for argument names.
3. Confirm each step from a fresh snapshot (URL, text, enabled or disabled) instead of assuming it worked.
4. For phone width, call `browser_resize` with 390 × 844.

## Signing in

The browser keeps its own profile, so a session carries over between runs. If a page lands on `/sign-in`, go to `/sign-up` and create a throwaway account: name `E2E Test`, email `e2e-<random>@example.com`, any password of 8 or more characters. Email accounts need no verification. Don't use Google sign-in.

Sending a chat message costs a model call, so only send one when the check needs a reply.

## Screenshots as proof

- Call `browser_take_screenshot` with `filename: ".playwright-mcp/<name>.png"` (gitignored), and `fullPage: true` for the whole page. A bare file name saves to the repo root.
- The tool returns the image. Look at it, and only call it proof once it shows the change.
- Attach them to the PR yourself with `gh`'s `--attach` flag, written as `<file>#<alt text>`. It works on `gh pr create`, `gh pr edit <n>` and `gh pr comment <n>`, and you can repeat it up to 50 times per command. If the body references a file as `![alt](./.playwright-mcp/x.png)`, gh rewrites that reference to the uploaded image; files the body doesn't reference get added to the end. Don't ask the user to drag them in.

## If the tools aren't there

MCP servers load when a session starts, and the user approves this project's server once. If there are no `mcp__playwright__` tools, tell the user to approve `playwright` under `/mcp`, or to restart the session.

On a new machine, the server needs Node.js 20 or later and Google Chrome. `bunx` downloads the pinned `@playwright/mcp` on first use.
