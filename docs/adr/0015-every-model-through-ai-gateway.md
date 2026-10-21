# Every model goes through Vercel AI Gateway, Claude included

Replies from every lab, Claude included, go through Vercel AI Gateway. a8 pins Claude requests to Anthropic (`providerOptions.gateway.only: ["anthropic"]`) and keeps sending Anthropic's provider tools and options. The spec planned OpenRouter for every model, but OpenRouter rejects Anthropic's BM25 tool search with a 400, and its AI SDK provider drops `deferLoading` on function tools (checked Oct 21, 2026). We picked AI Gateway over OpenRouter because it passes tool search through, adds no fee on top of model prices, and is part of the AI SDK. OpenRouter takes 5.5% of every credit purchase. a8 already deploys on Vercel.

This ADR first kept Claude on the Anthropic API, since the gateway's docs didn't say whether it passes tool search through. The gateway spike (`scripts/probe-gateway.ts`, issue #318) settled it on Oct 21, 2026. Three runs of Claude Haiku 5.5 through the gateway passed every check a8 relies on:

- Anthropic's BM25 tool search found a deferred tool, and the model called it.
- `deferLoading` kept deferred tools out of the prompt. Against a request with tool search and no connector tools, eight connector tools added 3,659 input tokens loaded and 93 deferred.
- A cache breakpoint wrote 13,796 tokens on the first request and read all of them on the second. The same prompt without the breakpoint read nothing, so the reads come from the breakpoint.
- The gateway accepted a client tool call placed before two tool search results, the order that breaks with gateway-executed tools (vercel/ai#21895). The model then called a tool that only the replayed search had loaded, so the search results reached Anthropic.

a8 offers a short list of models, kept in code, not every model the gateway lists. Every model on the list has been tried with connectors and action cards, and adding one takes a pull request.

## Considered options

- **Claude direct, other labs through AI Gateway (this ADR's first decision):** works, but needs two providers, an Anthropic price table, and a key for each.
- **OpenRouter for every model (the original Stage 9 plan):** one key and per-request cost in its usage data, but it breaks tool search on Claude and charges 5.5% on credits.
- **OpenRouter for other labs only:** works, but costs the 5.5% fee for nothing AI Gateway lacks.
- **A direct key per lab:** no middleman, but a separate integration, error mapping and price table for each lab.

## Consequences

- A credit's cost comes from one place, the cost AI Gateway reports for each generation (`getGenerationInfo`, in USD). a8 drops its Anthropic price table (`convex/lib/modelPrices.ts`) when the model layer moves Claude onto the gateway.
- `AI_GATEWAY_API_KEY` becomes the one model key, and self-hosters need it too. A self-hoster who wants to pay Anthropic directly adds their Anthropic key to the gateway as BYOK. a8 drops `ANTHROPIC_API_KEY` along with the price table.
- Claude replies keep Anthropic's tool search (ADR 0006), `deferLoading` and cache breakpoints, through `providerOptions.anthropic`. Other labs have no Anthropic tool search, so a8 needs its own for them (ADR 0016). Their caching is the gateway's automatic caching where the lab supports it.
- Claude replies depend on the gateway being up, and on it passing new Anthropic features through. Before a8 adopts a new Anthropic feature, run the probe against it.
