---
status: superseded by ADR-0005
---

# Apps join a thread only when the user @mentions them

The model only sees tools from a thread's active apps, and the only way to make an app active is to type its handle after @. Loading every connected app's tools on every reply looks simpler, but Notion has 35 tools and GitHub about 45 (Anthropic measured 35 of GitHub's at 26k tokens), so a few connected apps add tens of thousands of tokens of tool definitions to each reply and make the model worse at picking the right tool. If the user asks for an app they haven't mentioned, the model tells them to type @ and the handle, and the composer placeholder hints at the syntax. The model never activates an app itself.

Mentions alone don't keep the count low enough. Anthropic says tool choice degrades past 30 to 50 tools, and GitHub alone reaches that. So each connector in the catalog also lists the tools a8 exposes, and a8 labels each one as a read or an action. a8's label decides whether a tool needs approval. The server's `readOnlyHint` can only make a tool stricter, because the MCP spec treats annotations as untrusted hints. The cost is editing a connector's list when the vendor adds a tool worth exposing.

## Considered options

- **Every connected app, every reply:** no syntax to learn, but the token cost and tool-choice accuracy get worse with each app connected.
- **Every connected app behind a tool search step:** keeps the "model decides" feel and removes the curated lists. It's the likely next step. Anthropic's built-in search is Claude only, so a8 would need its own search to keep working once other models arrive in Stage 9.
- **Every tool the server lists, labeled by its annotations:** no lists to maintain, but Notion doesn't document annotations, and a server's own labels decide what skips approval.
- **A "+" picker in the composer:** dropped for v1 so there is one way in. Typing @ opens an autocomplete list of connected apps.
