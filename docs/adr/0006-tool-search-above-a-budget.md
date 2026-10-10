# Above a tool budget, connector tools are deferred and found by tool search

When the tool definitions of a user's connections fit a budget of about 10k tokens, every tool loads on every reply, as ADR 0005 says. Above that budget, mentioned connectors still load, up to a cap, and every other connector tool is deferred: the model sees a search tool and finds the tools it needs by searching. On Claude, a8 uses Anthropic's native tool search with `deferLoading`, which keeps the prompt cache. The system prompt still names every connection, one line each. This replaces ADR 0005's 40-tool cap, where only mentioned connectors loaded, and its `load_connector(handle)` proposal.

The budget counts tokens, not tools, because one tool's schema can be ten times the size of another's. The choice between loading and deferring is made once per thread, so a thread that crosses the line doesn't change its tool prefix and lose the prompt cache. Deferred tools carry the connector's name at the start of their description ("[Linear] ...") so that search matches terse names like `get_issue`.

## Considered options

- **`load_connector(handle)`:** works on any model, but it loads a whole connector at once, and GitHub alone has more than 50 tools.
- **AI SDK `toolSearch()` only:** works on any model, but it matches keywords, not meaning, and the docs say it can invalidate the cached prompt prefix.
- **Always defer:** keeps the cache with no budget logic, but adds a search round trip even when the user has one small connector.
- **Let the user pick connectors per chat (Claude.ai's tool access modes):** more control, but more settings for users who aren't technical. Mentions already steer one prompt.

## Consequences

- The MCP spec has no tool search of its own (October 2026), so a8 does the search on its side, as the MCP client best-practices doc recommends.
- A deferred tool can't carry `cache_control`, and at least one tool must stay loaded. The native tools (web search) always are.
- Native search stores tool references in the thread's history. A later reply whose tool list drops a referenced tool (after a disconnect or an allowlist change) may be rejected, so a spike checks this before the build.
- AI SDK `toolSearch()` is not a drop-in fallback for other models. Its found tools last only for one `streamText` call, and each approval continuation (ADR 0002) is a new call. Stage 9 has to handle that.
- Deferred actions still go in `toolApproval`, because the model can call them at any step.
- Tool search needs Opus or Sonnet 4.5 or later, so a8 turns it on only for models that support it.
