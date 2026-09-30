# Plans

> **Frozen on 2026-10-01.** Work is now tracked in [GitHub Issues](https://github.com/abdtriedcoding/a8-chat/issues): `/to-spec` publishes each spec as one issue, and `/to-tickets` splits it into tickets. Don't add new plan files here. This folder keeps the stage roadmap below and the plans written before the switch.

## Stages

The build runs in nine stages, in order. Stages 1 to 8 build and ship v0.1 on Claude through the Anthropic API; Stage 9 comes last and opens a8 to every model through OpenRouter. Each stage is named for what it delivers, not for a date: it's done when its work is done, however early that is, and the next one starts straight away. Stages 2, 4, 6 and 8 end at a gate that has to pass before the next stage starts.

| Stage | What it delivers |
|---|---|
| 1 · Foundation | Public repo, sign-in and streaming chat |
| 2 · Daily chat | Stop, regenerate and edit, uploads, markdown, titles and thread search, web search and rate limits |
| 3 · MCP connectors | Tool interface, MCP client, token vault, Notion, Linear, custom URLs and @mentions |
| 4 · Google connectors | Gmail, Google Calendar and the connector catalog |
| 5 · Approvals | Approval cards for every write, and Google verification |
| 6 · Slack and beta | Slack, the app router, the activity log and the first beta users |
| 7 · Billing and self-host | Credits, Free and Pro plans, and Docker Compose |
| 8 · Launch | Domain, landing page, docs site and the v0.1 release |
| 9 · Any model | OpenRouter, the model catalog and picker, and a self-hoster's key |

Work can be pulled forward from a later stage, and it keeps that stage's name. The landing page, for example, is Stage 8 work that was built early.

## Archive

Plans written before the switch to GitHub Issues. Legend: `[x]` done · `[ ]` to do · 👤 a step the maintainer does by hand.

| Stage | Plan | Status |
|---|---|---|
| 1 · Foundation | [Auth and streaming chat](stage-1-foundation.md) | Done |
| 8 · Launch | [Design system and landing page](stage-8-landing-page-and-design-system.md) (pulled forward) | Frozen; its open steps move to issues when the work resumes |