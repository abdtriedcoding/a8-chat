# Claude goes direct, every other lab goes through Vercel AI Gateway

Claude replies keep calling the Anthropic API directly, and models from every other lab go through Vercel AI Gateway. The spec planned OpenRouter for every model, but OpenRouter rejects Anthropic's BM25 tool search with a 400, and its AI SDK provider drops `deferLoading` on function tools (checked Oct 21, 2026). Sending Claude through it would break deferred tools (ADR 0006). AI Gateway's docs don't say whether it passes tool search through, so Claude stays direct either way. For the other labs, AI Gateway was picked over OpenRouter because it adds no fee on top of model prices, while OpenRouter takes 5.5% of every credit purchase. a8 already deploys on Vercel, and the gateway is part of the AI SDK.

a8 offers a short list of models, kept in code, not every model the gateway lists. Every model on the list has been tried with connectors and action cards, and adding one takes a pull request.

## Considered options

- **OpenRouter for every model (the original Stage 9 plan):** one key and per-request cost in its usage data, but it breaks tool search on Claude and charges 5.5% on credits.
- **OpenRouter for other labs only:** works, but costs the 5.5% fee for nothing AI Gateway lacks.
- **A direct key per lab:** no middleman, but a separate integration, error mapping and price table for each lab.

## Consequences

- A credit's cost comes from two places: Anthropic's token prices for Claude, and the cost AI Gateway reports for each generation (`getGenerationInfo`, in USD).
- A self-hoster sets `ANTHROPIC_API_KEY`, `AI_GATEWAY_API_KEY`, or both. The picker shows only the models those keys can reach.
- Models off Claude have no Anthropic tool search, so a8 needs its own (ADR 0016).
- Prompt cache breakpoints go through `providerOptions.anthropic` on Claude only. Gateway models use the gateway's automatic caching where the lab supports it.
