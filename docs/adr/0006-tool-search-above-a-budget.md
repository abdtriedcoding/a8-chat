# Above a tool budget, connector tools are deferred and found by tool search

When the tool definitions of a user's connections fit a budget of about 35k tokens, every tool loads on every reply, as ADR 0009 says. Above that budget, up to three mentioned connectors still load, and every other connector tool is deferred: the model sees a search tool and finds the tools it needs by searching. On Claude, a8 uses Anthropic's native tool search with `deferLoading`, which keeps the prompt cache. The system prompt still names every connection. This replaces ADR 0005's 40-tool cap, where only mentioned connectors loaded, and its `load_connector(handle)` proposal.

The budget was about 10k tokens until the build measured the real sizes. a8's estimate puts Notion's 12 tools at about 32k tokens, Linear's 11 at about 6k and Todoist's 11 at about 4k. A reply with only Notion loaded used about 38k input tokens, so the estimate runs about 10% low. At 10k, Notion alone would defer, and a user with one connector would pay a search round trip on every question. At 35k of estimate, Notion alone loads, and Notion with any other connector defers.

The budget counts tokens, not tools, because one tool's schema can be ten times the size of another's. The choice between loading and deferring is made once per thread, so a thread that crosses the line doesn't change its tool prefix and lose the prompt cache. Deferred tools carry the connector's name at the start of their description ("[Linear] ...") so that search matches terse names like `get_issue`.

## Considered options

- **`load_connector(handle)`:** works on any model, but it loads a whole connector at once, and GitHub alone has more than 50 tools.
- **AI SDK `toolSearch()` only:** works on any model, but it matches keywords, not meaning, and the docs say it can invalidate the cached prompt prefix.
- **Always defer:** keeps the cache with no budget logic, but adds a search round trip even when the user has one small connector.
- **Let the user pick connectors per chat (Claude.ai's tool access modes):** more control, but more settings for users who aren't technical. Mentions already steer one prompt.

## Consequences

- The MCP spec has no tool search of its own (October 2026), so a8 does the search on its side, as the MCP client best-practices doc recommends.
- A deferred tool can't carry `cache_control`, and at least one tool must stay loaded. Native tools like web search always load, and while connector tools are deferred the search tool loads with them. At or under the budget nothing is deferred, so the search tool isn't offered.
- Native search stores tool references in the thread's history. Anthropic rejects a later reply whose tool list drops a referenced tool, after a disconnect or an allowlist change. The tool search spike confirmed this, so each reply drops references to tools it no longer offers before the model call.
- AI SDK `toolSearch()` is not a drop-in fallback for other models. Its found tools last only for one `streamText` call, and each approval continuation (ADR 0002) is a new call. Stage 9 has to handle that.
- Deferred actions still go in `toolApproval`, because the model can call them at any step.
- Tool search needs a Claude 4.5 model or later. a8's chat model is Haiku 4.5, which the tool search spike found searches well, so the code has no model check. A model without tool search needs another way to load tools above the budget (ADR 0009).
