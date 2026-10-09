# Every connection's tools load on every reply, and a mention steers the model

Each reply offers the model the curated tools of every connection the user has, so it can search Notion without being told to. Typing `@notion` puts Notion's tools first and tells the model to use them. This replaces ADR 0004, where a connector's tools loaded only after a mention. Mention-only kept the token cost down, but it made the user name the app every time, and Gemini's connected apps showed the model can pick the app itself.

Tool count is still the risk, because tool choice gets worse past 30 to 50 tools. Each connector's curated list keeps its count down. When the curated tools across all connections pass 40, only mentioned connectors load. The system prompt still names every connection, so the model can ask the user to mention the one it needs.

A tool skips approval only when the server marks it `readOnlyHint` and the connector's list doesn't force approval on it. ADR 0004 let a8's own label decide alone.

## Open for v2

- **What happens above the 40-tool cap.** The proposal is that unmentioned connectors each get one line in the system prompt, plus a `load_connector(handle)` tool that adds that connector's tools from the next step on (`prepareStep` with `activeTools`). The model then reaches a connector without asking the user to mention it, and it works on any model. v1 ships Notion alone, about 15 tools, so it can't reach the cap.
- **Whether `readOnlyHint` can skip approval.** The proposal is to go back to ADR 0004's rule: a8's label alone decides, and the server's hint can only make a tool stricter. The allowlist already has an entry for every exposed tool, so a read or action label on each entry is one more field. The MCP spec calls annotations untrusted, Notion doesn't document its annotations, and a write tool the vendor wrongly marks read-only would run without asking.

## Considered options

- **Mention only (ADR 0004):** lowest token cost, but the model can't reach a connected app on its own.
- **Every tool the server lists, always:** no lists to keep up, but Notion and GitHub together pass 80 tools.
- **Tool search now:** removes the 40-tool cap, but it's more to build before the first connector ships. It's the next step once users hit the cap often.
