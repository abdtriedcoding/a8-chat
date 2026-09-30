# Plans

Implementation plans for a8, one Markdown file per plan. Each plan is written before its work starts, and its checkboxes are ticked as the work gets done. That keeps a running record of what was planned, what shipped, and why.

## Stages

The v0.1 build runs in eight stages, in order. Each stage is named for what it delivers, not for a date: it's done when its work is done, however early that is, and the next one starts straight away. Stages 2, 4, 6 and 8 end at a gate that has to pass before the next stage starts.

| Stage | What it delivers |
|---|---|
| 1 · Foundation | Public repo, sign-in and streaming chat |
| 2 · Daily chat | Model picker, uploads, markdown, web search and rate limits |
| 3 · MCP connectors | Tool interface, MCP client, token vault, Notion, Linear, custom URLs and @mentions |
| 4 · Google connectors | Gmail, Google Calendar and the connector catalog |
| 5 · Approvals | Approval cards for every write, and Google verification |
| 6 · Slack and beta | Slack, the app router, the activity log and the first beta users |
| 7 · Billing and self-host | Credits, Free and Pro plans, and Docker Compose |
| 8 · Launch | Domain, landing page, docs site and the v0.1 release |

Work can be pulled forward from a later stage, and it keeps that stage's name. The landing page, for example, is Stage 8 work that was built early.

## Conventions

- **File name:** `stage-<n>-<slug>.md`, after the stage the work belongs to. A stage can have several plans. Examples: `stage-2-daily-chat.md`, `stage-8-landing-page-and-design-system.md`. After v0.1, name plans after their release instead, e.g. `v0.2-memory.md`.
- **Header:** a status line at the top: `In progress`, `Done` or `Superseded`, with the day it started and, once done, the day it finished. No target dates. Dates only record when something happened, never when it's due.
- **Checkboxes:** `[x]` done · `[ ]` to do · 👤 a step the maintainer does by hand (accounts, keys, dashboards).
- **Ticks go in with the work.** Update a checkbox in the same commit as the change that completes it.
- **Scope changes:** edit the plan and add a one-line note on what changed and why, rather than deleting the old step without a trace.

## Index

| Stage | Plan | Status |
|---|---|---|
| 1 · Foundation | [Auth and streaming chat](stage-1-foundation.md) | Done |
| 8 · Launch | [Design system and landing page](stage-8-landing-page-and-design-system.md) (pulled forward) | In progress |
