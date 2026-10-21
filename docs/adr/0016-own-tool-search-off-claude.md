# Models other than Claude use a8's own tool search

When a thread's connector tools go over the tool budget (ADR 0006), a Claude reply finds deferred tools with Anthropic's native tool search, as before. Every other model gets a tool search tool that a8 writes itself. The tool searches the deferred tools' names and descriptions and loads the ones it finds into the thread. Anthropic's search runs only on Claude, even through AI Gateway (ADR 0015). Gemini has no tool search, and OpenAI's works only on its own models. One tool a8 owns covers every lab, for the same reason web search is a8's own tool (ADR 0001).

Claude keeps Anthropic's search because the tool search spike tested it, and it keeps the prompt cache.

## Considered options

- **a8's own search on every model, Claude included:** one code path, but it gives up a search that was tested and that keeps the cache.
- **Each lab's native search where it has one:** OpenAI's would work, but Gemini and the rest would still need a8's own, so this means two paths for nothing.
- **No deferral off Claude:** every connector tool loads up front, which blows past the context window once a user has several connectors.

## Consequences

- The tools a search finds have to outlast the `streamText` call that found them. An approval continuation (ADR 0002) is a new call, and AI SDK `toolSearch()` forgets its finds there (ADR 0006). a8 records found tools on the thread, so later replies and continuations load them.
- A thread that switches between Claude and another model changes which search it uses. When a thread switches away from Claude, a8 drops Anthropic's tool references from the history it sends, the same way it drops references to tools it no longer offers.
