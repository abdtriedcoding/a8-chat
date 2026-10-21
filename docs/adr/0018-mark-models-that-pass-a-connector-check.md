# Mark the models that pass a connector check

ADR 0017 put every tool-calling model on AI Gateway on the list, with the gateway's `tool-use` tag as the only check. On Oct 22, 2026, 16 models were tried with connectors in the browser, on a thread that defers connector tools. Thirteen found the Todoist tools with a8's tool search (ADR 0016), ran a read, showed an action card, and answered after the card was cancelled. Llama 4 Scout wrote its tool calls out as text. Nova Lite never searched for the connector tools and called a scheduled prompt tool instead. Grok 4.1 Fast Reasoning got a 404 from the gateway on every request.

Every model stays on the list, the ones that failed included. A lab can fix a model, and a model that can't use connectors still answers plain chat. `convex/lib/connectorChecks.ts` records each checked model's result, and the picker marks each model that passed with a plug icon. The filter menu has "Works with connectors". Users can pick any model and switch when one fails.

`scripts/check-connectors.ts` runs the same check against AI Gateway, with small fake connector tools in place of real ones. It rewrites the record with the models it checked and keeps every other entry, so results from the browser stay. It stops starting models once it has spent its budget.

## Considered options

- **Drop the models that fail:** the list holds only models that work, but a model that a lab fixes stays hidden until someone checks it again, and users lose models they'd use for chat only.
- **A hand-picked list of connector models:** the Featured tab already picks models, and whether a model handles connectors is a separate fact from whether a8 features it.
- **Mark the models that pass (this ADR):** every model stays reachable, and users can see which ones a8 has tried.

## Consequences

- The first run, on Oct 22, 2026, checked 112 Free models for $0.51, and 90 passed. Of the 22 that failed, 13 were the model: it never searched for the tools, wrote its tool calls as text, or listed the projects and never asked to add the task. The other 9 were errors from the gateway or the AI SDK, like a 400 on Grok 4.20 Multi-Agent and a 424 on Nova Pro, and a real reply would hit them too. The budget stopped the run before the last 26 Free models.
- A check on a Free model cost about half a cent on average. The script checks a Pro model only when someone names it with `--model`, since those cost more.
- A model with no mark may work. It just hasn't been checked. A model that failed looks the same as one never checked, and only the record says which.
- The script's fake tools are small. A model can pass it and still fail on a connector with large schemas, like Notion's. The browser check covered Notion on 4 models.
- New models from a sync have no mark until someone runs the script on them.
