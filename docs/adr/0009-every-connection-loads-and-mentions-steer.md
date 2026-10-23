# Every connection's tools load on every reply, and a mention steers the model

Each reply offers the model the allowlisted tools of every working connection the user has, so it can search Notion without being told to. A connection that needs reconnecting offers no tools. Typing `@notion` adds a note to the prompt that tells the model to answer with Notion's tools before web search or its own knowledge. The note goes with the prompt, not in the instructions, and the tools keep their order, so a mention doesn't change the tools and instructions that Claude reads from the prompt cache. When the tools of all the user's connections pass the tool budget, ADR 0006 takes over. Up to three mentioned connectors still load, and every other connector tool is deferred and found by tool search. This ADR merges ADR 0004 and ADR 0005, which were written and reversed within two days, into the rule the code follows.

ADR 0004 loaded a connector's tools only after a mention. That kept the token cost down, but it made the user name the app every time, and Gemini's connected apps showed the model can pick the app itself. Tool count is still the risk, because Anthropic says tool choice gets worse past 30 to 50 tools. Each catalog connector's allowlist keeps its count down, at about 10 tools and never more than 15, and ADR 0006's budget handles a user with many connections.

The instructions name every catalog connector with the user's status for it: connected (with the account label), needs reconnect, or not connected. So when the user asks about an app that isn't connected, the model sends them to the Connectors page instead of guessing what's in it. A mention of a connector that isn't connected, or needs reconnecting, tells the model the same. The composer won't send such a mention, but the status can change before the reply runs. A user with no connections gets no connector text at all, so the model isn't steered toward apps they never connected.

Whether a tool asks for approval is ADR 0008's rule.

## Considered options

- **Mention only (ADR 0004):** lowest token cost, but the model can't reach a connected app on its own.
- **Every tool the server lists, always:** no lists to keep up, but Notion and GitHub together pass 80 tools.
- **Only mentioned connectors above a 40-tool cap (ADR 0005):** replaced by ADR 0006's token budget. One tool's schema can be ten times the size of another's, and the model couldn't reach an unmentioned connector at all.
- **Only mentioned connectors, on models without tool search:** built as a "mentions" loading mode, then deleted in #148. The chat model is Haiku 5.5, which supports tool search. Re-add it when a8 runs a model without tool search (Stage 9).
- **A "+" picker in the composer:** dropped so there is one way in. Typing @ opens a menu of every connector, connected ones first.

## Consequences

- Above the budget, a mention is how the user makes a connector's tools load without a search step.
- A tool removed from a connector's allowlist stops being offered on the next reply. A tool added to it reaches each connection at that connection's next tool-list refresh.
