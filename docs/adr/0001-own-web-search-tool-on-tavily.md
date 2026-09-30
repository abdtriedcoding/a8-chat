# Web search is our own tool on Tavily, not the model's built-in search

a8 gives the model one web search tool that we write ourselves: it calls Tavily's REST API through a single `searchWeb(query)` function. Anthropic's built-in web search looks like the obvious choice while v0.1 runs on Claude, but it only works on Claude models, and it returns page content encrypted, so the page text can't be stored or shown. It would also have to be rebuilt when Stage 9 opens a8 to every model. Tavily was picked over the other search APIs for three reasons: its terms clearly allow showing results in a commercial app, it has the largest free tier (1,000 searches a month, which every self-hoster starts on), and it's pay-as-you-go with no plan to commit to.

## Considered options

- **Anthropic's built-in web search:** Claude only, $10 per 1,000 searches, and the page content comes back encrypted.
- **Firecrawl:** it scored slightly higher in the one independent test (the top four were statistically tied), and it's about four times cheaper per search on its $83+ a month plan. But its terms are vague on commercial use, and its free tier is half the size. Revisit in Stage 7 with real search volume; behind `searchWeb`, switching is a one-file change.
- **Exa:** its terms are unclear on showing results to users.
- **Brave:** it needs a card from the start and requires attribution. It also forbids storing results, which chat history does.
