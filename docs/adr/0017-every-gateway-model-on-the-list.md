# a8 offers every chat model on AI Gateway

This replaces the short model list of ADR 0015. a8 now offers every model on Vercel AI Gateway that is a language model, takes tools, has at least 64,000 tokens of context, and isn't a batch model. On Oct 21, 2026 that was 251 models from 33 labs. Picking any model on the market is the point of a8, and a hand-tested list of seven models kept that from happening.

`scripts/sync-models.ts` reads the gateway's public model list (`https://ai-gateway.vercel.sh/v1/models`) and writes the models to `convex/lib/gatewayModels.ts`, with each one's name, description, context window, prices, what it reads and its tags. It saves each lab's logo from models.dev to `public/labs`. Someone runs the script, reads the diff and merges it, so the list still changes only through a pull request.

Prices set the plan. `convex/lib/models.ts` estimates a typical reply at 30,000 input tokens and 4,000 output tokens. A model whose typical reply costs 5 credits or less is on Free, and Pro gets every model. A model whose typical reply costs over 100 credits isn't listed (issue #423). On Oct 21, 2026 that dropped GPT 5.5 Pro, GPT 5.4 Pro and GPT 5.2 Pro, whose typical reply costs over a fifth of Pro's month, and a burst of them could pass the daily spend ceiling before a cost landed. The seven models from before keep their plans, and their estimates stay within half a credit of the hand-set ones.

## Considered options

- **Keep a short tested list (ADR 0015):** every model is known to work with connectors and action cards, but users can't reach most of the market.
- **Read the gateway's list at runtime, into a Convex table on a cron:** new models show up with no pull request, but every model lookup that runs in the browser and in mutations would turn into a database read, and a model could appear without anyone reading the change.
- **Generate the list into code (this ADR):** lookups stay synchronous, the list stays typed, and every change shows in a diff.

## Consequences

- Most models on the list haven't been tried with connectors or action cards. The gateway's `tool-use` tag is the only check. ADR 0018 marks the models that passed a connector check and keeps the rest on the list.
- New models wait for someone to run the script. A scheduled job that runs it and opens a pull request would close that gap.
- A model the gateway drops leaves the list on the next sync. Threads on it fall back to the default model, as before (lib/threadModels.ts).
- Every Claude model gets Anthropic's tool search and cache breakpoints (ADR 0015, ADR 0016). The gateway lists only Claude 4.5 and later, which all support them.
- The browser loads the whole list for the picker, about 90 KB before compression.
